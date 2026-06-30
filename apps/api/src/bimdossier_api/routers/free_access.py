"""Shared access helpers for the pooled free tier.

The free tier has two planes:

  * **Data plane** (`free_projects` / `free_models` / `free_findings`) — served via
    `get_free_session` (ROLE bim_app, only `app.current_user_id` set). Owner-OR-
    member RLS (see `_rls_sql.enable_free_member_rls_statements`) does the
    isolation. The role helpers below run INSIDE that session and rely on RLS to
    scope what they can see.

  * **Control plane** (membership management, the org-membership create-gate) —
    reads/writes `users` and `organization_members`, both of which the free
    session's RLS hides (there is no `app.current_org_id` for an org-less
    account, so the org-keyed policies match zero rows). These MUST run on a
    SUPERUSER session (RLS-bypassing) with ownership validated by hand — the same
    pattern the org-invite flow and `_claim_free_extraction_slot` already use.

Both routers (`free_projects`, `free_viewer`) import from here.

**HARD RULE — superuser free probes MUST carry an owner predicate.** Any query
that runs on a SUPERUSER session over a pooled `free_*` table (i.e. NOT through
`get_free_session` / `open_free_session`, so RLS is bypassed) MUST filter on
`owner_user_id == <owner>` (or `user_id == <user>` for per-user tables). RLS is
OFF on these sessions, so the hand-written predicate is the ONLY thing scoping the
read to one user — drop it and the probe silently reads across every free user.
`user_has_org_membership`, `free_owner_used_bytes`, `assert_assignee_is_participant`
and the `resolve_free_limits` probe all follow this; a new probe added in this
style without the predicate is a cross-user leak. `tests/test_scope_isolation.py`
guards the aggregate-byte probe against regression.
"""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.config import get_settings
from bimdossier_api.db import get_session_maker
from bimdossier_api.free_limits import FreeLimits, resolve_free_limits
from bimdossier_api.models.free_attachment import FreeAttachment
from bimdossier_api.models.free_document import FreeDocument
from bimdossier_api.models.free_project import FreeProject
from bimdossier_api.models.free_project_file import FreeProjectFile
from bimdossier_api.models.free_project_member import FreeProjectMember
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.project_member import ProjectRole
from bimdossier_api.models.user import User

# The INVITED-member cap (owner not counted) is configurable — see
# Settings.free_max_members_per_project (alias FREE_MAX_MEMBERS_PER_PROJECT),
# read at the invite site in routers/free_projects.py.

# Roles that may write (file/edit/delete snags). Viewer is read-only; the owner
# can do everything. Model upload + member management are owner-only and checked
# separately. Mirrors the paid permission split (RLS = isolation, app = perms).
_FREE_WRITE_ROLES = (ProjectRole.owner.value, ProjectRole.editor.value)


def require_free_tier_enabled() -> None:
    """Gate every user-facing /free/* endpoint on the kill-switch (403
    FREE_TIER_DISABLED when off). The worker callback is secret-gated, not
    flag-gated, so in-flight extractions still complete if the flag is flipped.

    NOTE — two distinct axes, deliberately not conflated:
      * ``FREE_TIER_ENABLED`` (this gate) is the OPERATIONAL mount/launch
        kill-switch: "is the free data plane offered/served at all right now".
      * The per-account ENTITLEMENT — "is THIS principal on the free plan" — is
        ``entitlements.resolve_plan(...) == PLAN_FREE`` (today: org-less). The
        free caps/trial gates (`assert_can_create_free_content`,
        `assert_free_account_not_expired`) are that entitlement re-check.
    Conversion (free→paid) intentionally does NOT call this gate, so disabling
    sales never traps a user's data behind the upgrade funnel."""
    if not get_settings().free_tier_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_TIER_DISABLED"
        )


async def assert_free_project_owned(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> None:
    """404 FREE_PROJECT_NOT_FOUND unless the caller OWNS the free project. Used by
    the owner-only create paths (a member may snag in a shared project but never
    create a container or upload a model)."""
    exists = (
        await session.execute(
            select(FreeProject.id).where(
                FreeProject.id == project_id, FreeProject.owner_user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_PROJECT_NOT_FOUND"
        )


async def user_has_org_membership(user_id: UUID) -> bool:
    """True if the user belongs to ANY organization (non-removed membership).

    Runs on its own SUPERUSER session: a free (bim_app) session can't see
    `organization_members` (org-keyed RLS, no org GUC). Cheap single-row probe.
    """
    async with get_session_maker()() as session, session.begin():
        found = await session.scalar(
            select(OrganizationMember.id)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.status != OrganizationMemberStatus.removed,
            )
            .limit(1)
        )
    return found is not None


async def user_has_free_participation(
    session: AsyncSession, user_id: UUID
) -> bool:
    """True if the user owns ≥1 free project OR is a member of ≥1 — drives the
    "Free workspace" switcher entry and gates switch-to-free.

    Must run on a session that can see the user's free rows: the superuser
    `get_async_session` (used by /auth/me + switch) works (RLS-bypassed); a free
    session also works (owner-OR-member RLS).
    """
    owns = await session.scalar(
        select(FreeProject.id).where(FreeProject.owner_user_id == user_id).limit(1)
    )
    if owns is not None:
        return True
    member = await session.scalar(
        select(FreeProjectMember.free_project_id)
        .where(FreeProjectMember.user_id == user_id)
        .limit(1)
    )
    return member is not None


async def assert_can_create_free_content(user: User) -> FreeLimits:
    """Gate free-content CREATION (projects + models) to org-less users whose
    trial window is still open, and RETURN their effective limits.

    A paid user (any org membership) may PARTICIPATE in a free project as a
    member, but must never create free projects or upload free models — the free
    tier is the funnel for people without a paid org, not free capacity around an
    existing one. Raises 403 FREE_CREATE_FORBIDDEN otherwise.

    Also enforces the free TRIAL window: once the account is past its (possibly
    admin-overridden) max age it is read-only — raises 403 FREE_ACCOUNT_EXPIRED.
    The resolved `FreeLimits` is returned so the caller can enforce the numeric
    caps (projects / containers / storage) without re-reading the override row.

    NOTE (accepted residual race): the org-membership probe runs on its own
    superuser session because organization_members is RLS-hidden in the free
    session (no org GUC). A user added to an org in the narrow window between this
    check and the caller's insert could create one free project they shouldn't.
    This is a benign abuse-resistance gap (no cross-tenant exposure, bounded to a
    single row), not closable without cross-cutting locks, so it is left as-is.
    """
    if await user_has_org_membership(user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_CREATE_FORBIDDEN"
        )
    # User is org-less (a free account) here, so the trial applies directly.
    limits = await resolve_free_limits(user)
    if limits.is_expired:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_ACCOUNT_EXPIRED"
        )
    return limits


async def assert_free_account_not_expired(user: User) -> None:
    """403 FREE_ACCOUNT_EXPIRED once the acting FREE account's trial window has
    elapsed — the gate that makes an expired free account READ-ONLY on the
    write/edit paths (snags, container edits, member invites, …). Reads never call
    this. A no-op for org-bearing (paid) users — they are never on the free trial
    — and for admin-exempted / extended accounts (their `is_expired` is False)."""
    if await user_has_org_membership(user.id):
        return
    limits = await resolve_free_limits(user)
    if limits.is_expired:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_ACCOUNT_EXPIRED"
        )


async def resolve_free_role(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> str | None:
    """The caller's role on a free project: 'owner' | 'editor' | 'viewer' | None.

    Runs in the free (bim_app) session — RLS lets the caller read the project row
    iff they participate, and their OWN membership row. Returns None when the
    project is not visible (not a participant) or does not exist.
    """
    owner_id = await session.scalar(
        select(FreeProject.owner_user_id).where(FreeProject.id == project_id)
    )
    if owner_id is None:
        return None
    if owner_id == user_id:
        return "owner"
    role = await session.scalar(
        select(FreeProjectMember.role).where(
            FreeProjectMember.free_project_id == project_id,
            FreeProjectMember.user_id == user_id,
        )
    )
    return role


async def resolve_free_document_role(
    session: AsyncSession, document: FreeDocument, user_id: UUID
) -> str | None:
    """The caller's role on the project a document (container) belongs to.

    Every free container belongs to a project (free_project_id NOT NULL), so —
    unlike the old ungrouped-model case — there is always a project to resolve."""
    if document.owner_user_id == user_id:
        return "owner"
    return await resolve_free_role(session, document.free_project_id, user_id)


def require_free_write_role(role: str | None) -> None:
    """403 FREE_FORBIDDEN unless the caller may write (owner or editor)."""
    if role not in _FREE_WRITE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_FORBIDDEN"
        )


async def assert_assignee_is_participant(
    project_id: UUID, assignee_user_id: UUID
) -> None:
    """422 ASSIGNEE_NOT_A_PROJECT_MEMBER unless `assignee_user_id` participates in
    the project — i.e. is the OWNER or has a `free_project_members` row.

    Runs on its own SUPERUSER session (RLS-bypassing): the request's free
    (bim_app) session only lets the caller see their OWN membership row, so it
    can't confirm that *another* user is a member. Same control-plane pattern as
    `user_has_org_membership` / `_claim_free_extraction_slot`.
    """
    async with get_session_maker()() as session, session.begin():
        owner_id = await session.scalar(
            select(FreeProject.owner_user_id).where(FreeProject.id == project_id)
        )
        if owner_id == assignee_user_id:
            return
        member = await session.scalar(
            select(FreeProjectMember.user_id).where(
                FreeProjectMember.free_project_id == project_id,
                FreeProjectMember.user_id == assignee_user_id,
            )
        )
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ASSIGNEE_NOT_A_PROJECT_MEMBER",
        )


async def count_free_members(session: AsyncSession, project_id: UUID) -> int:
    """Number of INVITED members on a project (owner excluded)."""
    return (
        await session.scalar(
            select(func.count())
            .select_from(FreeProjectMember)
            .where(FreeProjectMember.free_project_id == project_id)
        )
    ) or 0


async def free_owner_used_bytes(session: AsyncSession, owner_id: UUID) -> int:
    """Total active free storage footprint for an owner: model-file bytes +
    attachment (photo/evidence) bytes (FSL-1). The 1 GB aggregate cap is enforced
    against this combined sum so photos can't bypass the ceiling. Both sums are
    owner-keyed; pass a SUPERUSER session when the caller isn't the owner (a
    member uploading evidence) so the RLS scope doesn't hide the owner's bytes in
    projects the caller doesn't share."""
    file_bytes = (
        await session.scalar(
            select(func.coalesce(func.sum(FreeProjectFile.size_bytes), 0)).where(
                FreeProjectFile.owner_user_id == owner_id,
                FreeProjectFile.deleted_at.is_(None),
            )
        )
    ) or 0
    attachment_bytes = (
        await session.scalar(
            select(func.coalesce(func.sum(FreeAttachment.size_bytes), 0)).where(
                FreeAttachment.owner_user_id == owner_id,
                FreeAttachment.deleted_at.is_(None),
            )
        )
    ) or 0
    return int(file_bytes) + int(attachment_bytes)
