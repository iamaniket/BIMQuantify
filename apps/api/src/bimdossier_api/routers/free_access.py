"""Shared access helpers for the pooled free tier.

The free tier has two planes:

  * **Data plane** (`pooled_projects` / `free_models` / `pooled_findings`) — served via
    `get_pooled_session` (ROLE bim_app, only `app.current_user_id` set). Owner-OR-
    member RLS (see `_rls_sql.enable_pooled_member_rls_statements`) does the
    isolation. The role helpers below run INSIDE that session and rely on RLS to
    scope what they can see.

  * **Control plane** (membership management, the org-membership create-gate) —
    reads/writes `users` and `organization_members`, both of which the free
    session's RLS hides (there is no `app.current_org_id` for an org-less
    account, so the org-keyed policies match zero rows). These MUST run on a
    SUPERUSER session (RLS-bypassing) with ownership validated by hand — the same
    pattern the org-invite flow and `_claim_pooled_extraction_slot` already use.

Both routers (`pooled_projects`, `free_viewer`) import from here.

**HARD RULE — superuser free probes MUST carry an owner predicate.** Any query
that runs on a SUPERUSER session over a pooled `free_*` table (i.e. NOT through
`get_pooled_session` / `open_pooled_session`, so RLS is bypassed) MUST filter on
`owner_user_id == <owner>` (or `user_id == <user>` for per-user tables). RLS is
OFF on these sessions, so the hand-written predicate is the ONLY thing scoping the
read to one user — drop it and the probe silently reads across every free user.
`user_has_org_membership`, `pooled_owner_used_bytes`, `assert_assignee_is_participant`
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
from bimdossier_api.entitlements import PLAN_FREE, PLAN_PAID, resolve_plan
from bimdossier_api.free_limits import FreeLimits, resolve_free_limits
from bimdossier_api.models.organization import Organization
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.pooled_attachment import PooledAttachment
from bimdossier_api.models.pooled_document import PooledDocument
from bimdossier_api.models.pooled_finding import PooledFinding
from bimdossier_api.models.pooled_finding_counter import PooledFindingCounter
from bimdossier_api.models.pooled_project import PooledProject
from bimdossier_api.models.pooled_project_file import PooledProjectFile
from bimdossier_api.models.pooled_project_member import PooledProjectMember
from bimdossier_api.models.project_member import ProjectRole
from bimdossier_api.models.user import User

# The INVITED-member cap (owner not counted) is configurable — see
# Settings.free_max_members_per_project (alias FREE_MAX_MEMBERS_PER_PROJECT),
# read at the invite site in routers/pooled_projects.py.

# Roles that may write (file/edit/delete snags). Viewer is read-only; the owner
# can do everything. Model upload + member management are owner-only and checked
# separately. Mirrors the paid permission split (RLS = isolation, app = perms).
_POOLED_WRITE_ROLES = (ProjectRole.owner.value, ProjectRole.editor.value)


def require_free_tier_enabled() -> None:
    """Gate every user-facing /free/* endpoint on the kill-switch (403
    FREE_TIER_DISABLED when off). The worker callback is secret-gated, not
    flag-gated, so in-flight extractions still complete if the flag is flipped.

    NOTE — two distinct axes, deliberately not conflated:
      * ``FREE_TIER_ENABLED`` (this gate) is the OPERATIONAL mount/launch
        kill-switch: "is the free data plane offered/served at all right now".
      * The per-account ENTITLEMENT — "is THIS principal on the free plan" — is
        ``entitlements.resolve_plan(...) == PLAN_FREE`` (today: org-less). The
        free caps/trial gate (`assert_can_create_free_content`) is that
        entitlement re-check.
    Conversion (free→paid) intentionally does NOT call this gate, so disabling
    sales never traps a user's data behind the upgrade funnel."""
    if not get_settings().free_tier_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_TIER_DISABLED"
        )


async def assert_pooled_project_owned(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> None:
    """404 FREE_PROJECT_NOT_FOUND unless the caller OWNS the free project. Used by
    the owner-only create paths (a member may snag in a shared project but never
    create a container or upload a model)."""
    exists = (
        await session.execute(
            select(PooledProject.id).where(
                PooledProject.id == project_id, PooledProject.owner_user_id == user_id
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


async def resolve_user_plan(user: User) -> str:
    """The user's effective entitlement PLAN — the single server-side TIER source.

    Applies ``entitlements.resolve_plan`` to the user's active org: org-less ⇒
    ``"free"``; an org member ⇒ that org's stored ``plan`` (default ``"paid"``).
    Superusers are platform operators, never free-plane principals, so they
    resolve to PAID — this keeps an org-less super-admin OFF the pooled free tier
    (POOL-SUPERADMIN-TIER-1: they can't create pooled content). Runs on a SUPERUSER
    probe because ``organizations`` / ``organization_members`` are RLS-hidden to a
    pooled (bim_app) session. This is the entitlement re-check; it stays orthogonal
    to ISOLATION (which data plane ``get_scoped_session`` picks from the JWT)."""
    if user.is_superuser:
        return PLAN_PAID
    async with get_session_maker()() as session, session.begin():
        org = await session.scalar(
            select(Organization)
            .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
            .where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.status != OrganizationMemberStatus.removed,
            )
            .limit(1)
        )
    return resolve_plan(org)


async def user_has_pooled_participation(
    session: AsyncSession, user_id: UUID
) -> bool:
    """True if the user owns ≥1 free project OR is a member of ≥1 — drives the
    "Free workspace" switcher entry and gates switch-to-free.

    Must run on a session that can see the user's free rows: the superuser
    `get_async_session` (used by /auth/me + switch) works (RLS-bypassed); a free
    session also works (owner-OR-member RLS).
    """
    owns = await session.scalar(
        select(PooledProject.id).where(PooledProject.owner_user_id == user_id).limit(1)
    )
    if owns is not None:
        return True
    member = await session.scalar(
        select(PooledProjectMember.pooled_project_id)
        .where(PooledProjectMember.user_id == user_id)
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
    admin-overridden) max age, NEW-ASSET creation is blocked — raises 403
    FREE_ACCOUNT_EXPIRED. This is deliberately the ONLY expiry gate: the field
    loop (snags, photos, member invites, edits, calibration) keeps working
    forever on existing projects — bounded by the lifetime findings cap, the
    aggregate storage cap, and the member cap rather than the trial clock.
    The resolved `FreeLimits` is returned so the caller can enforce the numeric
    caps (projects / containers / storage) without re-reading the override row.

    Gates on the ENTITLEMENT (`resolve_user_plan(user) == PLAN_FREE`) rather than
    raw org-presence, so the single tier source decides — and an org-less SUPERUSER
    (resolved to PAID) is kept off the free create path (POOL-SUPERADMIN-TIER-1).

    NOTE (accepted residual race): the plan probe runs on its own superuser session
    because organizations / organization_members are RLS-hidden in the free session
    (no org GUC). A user added to an org in the narrow window between this check and
    the caller's insert could create one free project they shouldn't. This is a
    benign abuse-resistance gap (no cross-tenant exposure, bounded to a single row),
    not closable without cross-cutting locks, so it is left as-is.
    """
    if await resolve_user_plan(user) != PLAN_FREE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_CREATE_FORBIDDEN"
        )
    # Caller is on the free plan here, so the trial applies directly.
    limits = await resolve_free_limits(user)
    if limits.is_expired:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_ACCOUNT_EXPIRED"
        )
    return limits


async def resolve_pooled_role(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> str | None:
    """The caller's role on a free project: 'owner' | 'editor' | 'viewer' | None.

    Runs in the free (bim_app) session — RLS lets the caller read the project row
    iff they participate, and their OWN membership row. Returns None when the
    project is not visible (not a participant) or does not exist.
    """
    owner_id = await session.scalar(
        select(PooledProject.owner_user_id).where(PooledProject.id == project_id)
    )
    if owner_id is None:
        return None
    if owner_id == user_id:
        return "owner"
    role = await session.scalar(
        select(PooledProjectMember.role).where(
            PooledProjectMember.pooled_project_id == project_id,
            PooledProjectMember.user_id == user_id,
        )
    )
    return role


async def resolve_pooled_document_role(
    session: AsyncSession, document: PooledDocument, user_id: UUID
) -> str | None:
    """The caller's role on the project a document (container) belongs to.

    Every free container belongs to a project (pooled_project_id NOT NULL), so —
    unlike the old ungrouped-model case — there is always a project to resolve."""
    if document.owner_user_id == user_id:
        return "owner"
    return await resolve_pooled_role(session, document.pooled_project_id, user_id)


def require_pooled_write_role(role: str | None) -> None:
    """403 FREE_FORBIDDEN unless the caller may write (owner or editor)."""
    if role not in _POOLED_WRITE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_FORBIDDEN"
        )


async def assert_assignee_is_participant(
    project_id: UUID, assignee_user_id: UUID
) -> None:
    """422 ASSIGNEE_NOT_A_PROJECT_MEMBER unless `assignee_user_id` participates in
    the project — i.e. is the OWNER or has a `pooled_project_members` row.

    Runs on its own SUPERUSER session (RLS-bypassing): the request's free
    (bim_app) session only lets the caller see their OWN membership row, so it
    can't confirm that *another* user is a member. Same control-plane pattern as
    `user_has_org_membership` / `_claim_pooled_extraction_slot`.
    """
    async with get_session_maker()() as session, session.begin():
        owner_id = await session.scalar(
            select(PooledProject.owner_user_id).where(PooledProject.id == project_id)
        )
        if owner_id == assignee_user_id:
            return
        member = await session.scalar(
            select(PooledProjectMember.user_id).where(
                PooledProjectMember.pooled_project_id == project_id,
                PooledProjectMember.user_id == assignee_user_id,
            )
        )
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ASSIGNEE_NOT_A_PROJECT_MEMBER",
        )


async def count_pooled_members(session: AsyncSession, project_id: UUID) -> int:
    """Number of INVITED members on a project (owner excluded)."""
    return (
        await session.scalar(
            select(func.count())
            .select_from(PooledProjectMember)
            .where(PooledProjectMember.pooled_project_id == project_id)
        )
    ) or 0


async def pooled_owner_used_bytes(session: AsyncSession, owner_id: UUID) -> int:
    """Total active free storage footprint for an owner: model-file bytes +
    attachment (photo/evidence) bytes (FSL-1). The 3 GB aggregate cap is enforced
    against this combined sum so photos can't bypass the ceiling. Both sums are
    owner-keyed; pass a SUPERUSER session when the caller isn't the owner (a
    member uploading evidence) so the RLS scope doesn't hide the owner's bytes in
    projects the caller doesn't share."""
    file_bytes = (
        await session.scalar(
            select(func.coalesce(func.sum(PooledProjectFile.size_bytes), 0)).where(
                PooledProjectFile.owner_user_id == owner_id,
                PooledProjectFile.deleted_at.is_(None),
            )
        )
    ) or 0
    attachment_bytes = (
        await session.scalar(
            select(func.coalesce(func.sum(PooledAttachment.size_bytes), 0)).where(
                PooledAttachment.owner_user_id == owner_id,
                PooledAttachment.deleted_at.is_(None),
            )
        )
    ) or 0
    return int(file_bytes) + int(attachment_bytes)


async def pooled_owner_finding_count(session: AsyncSession, owner_id: UUID) -> int:
    """LIVE findings (snags) currently owned by `owner_id` across all their pooled
    projects — display/diagnostic only; the cap gate uses the LIFETIME counter
    (`pooled_owner_lifetime_finding_count`), which deletes never decrement.

    Owner-keyed like `pooled_owner_used_bytes` — a member may file a snag against the
    owner's project, so the count is keyed on the project OWNER (`owner_user_id`), and
    a SUPERUSER session MUST be passed when the caller isn't the owner: a member's RLS
    scope would hide the owner's snags in projects the member doesn't share, under-
    counting the cap (H4: every superuser pooled probe carries an owner predicate)."""
    return (
        await session.scalar(
            select(func.count())
            .select_from(PooledFinding)
            .where(PooledFinding.owner_user_id == owner_id)
        )
    ) or 0


async def pooled_owner_lifetime_finding_count(
    session: AsyncSession, owner_id: UUID
) -> int:
    """Findings EVER created against `owner_id`'s projects (open+closed+deleted) —
    what the LIFETIME cap is enforced against. Reads the monotonic counter row;
    a missing row falls back to the live count (defensive parity for rows seeded
    by raw SQL before the counter existed — post-backfill absence means zero
    anyway). Same superuser-probe + owner-predicate rules as
    `pooled_owner_finding_count`."""
    counted = await session.scalar(
        select(PooledFindingCounter.lifetime_created).where(
            PooledFindingCounter.owner_user_id == owner_id
        )
    )
    if counted is not None:
        return int(counted)
    return await pooled_owner_finding_count(session, owner_id)
