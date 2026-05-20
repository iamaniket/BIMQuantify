"""Tenant & user management rules.

Pure helpers that enforce the invariants every membership mutation must
respect. Each rule raises a 409/422 `HTTPException` with a bare-string
error code (matching the existing convention — see `SEAT_LIMIT_EXCEEDED`
in `admin/seats.py`).

The same "surviving admin set" query backs both the assertion helpers
and `compute_member_capabilities`, so the API can never disable a button
that the server would have accepted, or accept an action it told the
portal was blocked.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User


# Valid membership status transitions. Anything not in this set raises
# INVALID_STATUS_TRANSITION. `removed` is terminal — re-invite creates a
# fresh row.
_ALLOWED_TRANSITIONS: frozenset[tuple[OrganizationMemberStatus, OrganizationMemberStatus]] = (
    frozenset(
        {
            (OrganizationMemberStatus.pending, OrganizationMemberStatus.active),
            (OrganizationMemberStatus.pending, OrganizationMemberStatus.suspended),
            (OrganizationMemberStatus.pending, OrganizationMemberStatus.removed),
            (OrganizationMemberStatus.active, OrganizationMemberStatus.suspended),
            (OrganizationMemberStatus.active, OrganizationMemberStatus.removed),
            (OrganizationMemberStatus.suspended, OrganizationMemberStatus.active),
            (OrganizationMemberStatus.suspended, OrganizationMemberStatus.removed),
        }
    )
)


@dataclass(frozen=True)
class ProposedChange:
    """Describes how a membership row would look after a mutation.

    Pass the *post-mutation* values: status the row would have, admin flag
    it would have, and whether the row would still exist (False for
    DELETE).
    """

    user_id: UUID
    new_status: OrganizationMemberStatus | None  # None when the row is being deleted
    new_is_admin: bool
    deleted: bool = False


@dataclass(frozen=True)
class MemberCapabilities:
    """Per-member action flags surfaced in the list endpoint so the portal
    can disable buttons up front instead of waiting for a 409.
    """

    is_last_admin: bool
    can_remove: bool
    can_demote: bool
    can_suspend: bool


# ---------------------------------------------------------------------------
# Org-level preconditions
# ---------------------------------------------------------------------------


def assert_org_mutable(org: Organization) -> None:
    """Block every write when the org isn't `active`. Reads stay open on
    `suspended` orgs so admins can see what's there; `deleted` is already
    blocked by `_load_org_or_404`.
    """
    if org.deleted_at is not None or org.status != OrganizationStatus.active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ORG_NOT_ACTIVE",
        )


def assert_not_self_action(requester_id: UUID, target_user_id: UUID) -> None:
    """The admin PATCH/DELETE routes are for acting on *other* members.
    Self-departure goes through `/me/memberships/{org}/leave` so its UX
    and audit trail are distinct.
    """
    if requester_id == target_user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="SELF_ACTION_FORBIDDEN",
        )


def assert_valid_status_transition(
    current: OrganizationMemberStatus, proposed: OrganizationMemberStatus
) -> None:
    """Reject any transition not in the allowed graph. Same-state writes
    are no-ops at the router level, so they don't reach this guard.
    """
    if current == proposed:
        return
    if (current, proposed) not in _ALLOWED_TRANSITIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="INVALID_STATUS_TRANSITION",
        )


# ---------------------------------------------------------------------------
# Last-admin invariant
# ---------------------------------------------------------------------------


async def _surviving_admin_ids(
    session: AsyncSession,
    organization_id: UUID,
    lock: bool,
) -> set[UUID]:
    """Return the user_ids of members who satisfy the last-admin invariant
    as they are RIGHT NOW: `is_org_admin=true AND status IN (active,
    suspended) AND users.is_active=true`. Pending admin invites are
    deliberately excluded — an unaccepted invite cannot keep an org alive.

    `lock=True` adds `FOR UPDATE` so two concurrent demotes can't both
    read "another admin exists" and both commit. The lock is held until
    the surrounding transaction ends.
    """
    stmt = (
        select(OrganizationMember.user_id)
        .join(User, User.id == OrganizationMember.user_id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_org_admin.is_(True),
            OrganizationMember.status.in_(
                (
                    OrganizationMemberStatus.active,
                    OrganizationMemberStatus.suspended,
                )
            ),
            User.is_active.is_(True),
        )
    )
    if lock:
        stmt = stmt.with_for_update(of=OrganizationMember)
    result = await session.execute(stmt)
    return {row[0] for row in result.all()}


def _row_satisfies_invariant(change: ProposedChange) -> bool:
    """A row's post-mutation contribution to the surviving-admin set.
    Globally-deactivated users (is_active=false) never satisfy the
    invariant — that check is layered on by the caller via
    `_surviving_admin_ids` which joins to users.
    """
    if change.deleted:
        return False
    if not change.new_is_admin:
        return False
    return change.new_status in (
        OrganizationMemberStatus.active,
        OrganizationMemberStatus.suspended,
    )


async def assert_last_admin_invariant(
    session: AsyncSession,
    organization_id: UUID,
    proposed_change: ProposedChange,
    lock: bool = True,
) -> None:
    """Block the proposed change if it would leave the org with zero
    surviving admins (active or suspended, user.is_active=true).

    Pass the post-mutation row state via `proposed_change`. The helper
    computes "surviving admins after this change" by subtracting the
    target row's current contribution (it's already in the DB result)
    and adding back its proposed contribution.
    """
    surviving = await _surviving_admin_ids(session, organization_id, lock=lock)

    post_change = set(surviving)
    # Remove the target's current contribution (if it was in the set).
    post_change.discard(proposed_change.user_id)
    # Add back the target's post-mutation contribution.
    if _row_satisfies_invariant(proposed_change):
        post_change.add(proposed_change.user_id)

    if not post_change:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="LAST_ADMIN_REQUIRED",
        )


# ---------------------------------------------------------------------------
# Last-superuser invariant (platform level)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProposedUserChange:
    """Describes how a User row would look after a mutation. `deleted=True`
    when the row is being removed entirely.
    """

    is_superuser: bool
    is_active: bool
    deleted: bool = False


async def _surviving_superuser_ids(session: AsyncSession, lock: bool) -> set[UUID]:
    """Active platform superusers: `is_superuser=true AND is_active=true`.
    """
    stmt = select(User.id).where(User.is_superuser.is_(True), User.is_active.is_(True))
    if lock:
        stmt = stmt.with_for_update(of=User)
    result = await session.execute(stmt)
    return {row[0] for row in result.all()}


async def assert_last_superuser_invariant(
    session: AsyncSession,
    target_user_id: UUID,
    proposed: ProposedUserChange,
    lock: bool = True,
) -> None:
    """Block demoting/deactivating/deleting the last surviving superuser.
    Same shape as the org last-admin rule.
    """
    surviving = await _surviving_superuser_ids(session, lock=lock)

    post_change = set(surviving)
    post_change.discard(target_user_id)
    if not proposed.deleted and proposed.is_superuser and proposed.is_active:
        post_change.add(target_user_id)

    if not post_change:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="LAST_SUPERUSER_REQUIRED",
        )


# ---------------------------------------------------------------------------
# Owned-projects protection
# ---------------------------------------------------------------------------


async def list_owned_project_ids(
    session: AsyncSession, schema_name: str, user_id: UUID
) -> list[UUID]:
    """Return ids of projects in `schema_name` whose owner is `user_id`."""
    await session.execute(text(f'SET LOCAL search_path = "{schema_name}", public'))
    try:
        result = await session.execute(
            text("SELECT id FROM projects WHERE owner_id = :uid"),
            {"uid": str(user_id)},
        )
        return [row[0] for row in result.all()]
    finally:
        await session.execute(text("SET LOCAL search_path = public"))


async def assert_no_owned_projects(
    session: AsyncSession,
    org: Organization,
    user_id: UUID,
    reassign_to: UUID | None,
) -> None:
    """Block removal if the user owns projects in this org. If `reassign_to`
    is provided AND that user is an active org member, transfer ownership
    in the same transaction and return cleanly.

    Caller must commit. Search path is restored before returning so
    subsequent ORM operations target the master schema as expected.
    """
    owned = await list_owned_project_ids(session, org.schema_name, user_id)
    if not owned:
        return

    if reassign_to is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "OWNS_ACTIVE_PROJECTS",
                "project_ids": [str(pid) for pid in owned],
            },
        )

    # `reassign_to` must be an *active* member of this org. Pending/suspended
    # would inherit ownership of a project they can't open.
    target_member = await session.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == reassign_to,
            OrganizationMember.organization_id == org.id,
            OrganizationMember.status == OrganizationMemberStatus.active,
        )
    )
    if target_member.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="REASSIGN_TARGET_NOT_ELIGIBLE",
        )

    await session.execute(text(f'SET LOCAL search_path = "{org.schema_name}", public'))
    try:
        await session.execute(
            text("UPDATE projects SET owner_id = :new WHERE owner_id = :old"),
            {"new": str(reassign_to), "old": str(user_id)},
        )
        # The `uq_one_owner_per_project` partial unique index forces us to
        # drop any pre-existing owner row for the new owner on those
        # projects (rare — usually they're not yet owner) before promoting.
        await session.execute(
            text(
                "DELETE FROM project_members "
                "WHERE project_id = ANY(:pids) AND user_id = :new AND role = 'owner'"
            ),
            {"pids": [str(pid) for pid in owned], "new": str(reassign_to)},
        )
        await session.execute(
            text(
                "UPDATE project_members SET role = 'owner' "
                "WHERE project_id = ANY(:pids) AND user_id = :new"
            ),
            {"pids": [str(pid) for pid in owned], "new": str(reassign_to)},
        )
        # If the new owner didn't have a project_members row, insert one.
        await session.execute(
            text(
                "INSERT INTO project_members (project_id, user_id, role) "
                "SELECT p.id, :new, 'owner' FROM projects p "
                "WHERE p.id = ANY(:pids) "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM project_members pm "
                "  WHERE pm.project_id = p.id AND pm.user_id = :new"
                ")"
            ),
            {"pids": [str(pid) for pid in owned], "new": str(reassign_to)},
        )
    finally:
        await session.execute(text("SET LOCAL search_path = public"))


# ---------------------------------------------------------------------------
# Invitation expiry — read-time helpers
# ---------------------------------------------------------------------------


def invitation_expires_at(invited_at: datetime, ttl_days: int) -> datetime:
    """Wall-clock instant at which a pending invite is considered expired."""
    from datetime import timedelta

    return invited_at + timedelta(days=ttl_days)


def invitation_is_expired(invited_at: datetime, ttl_days: int) -> bool:
    return datetime.now(timezone.utc) >= invitation_expires_at(invited_at, ttl_days)


def assert_invitation_not_expired(invited_at: datetime, ttl_days: int) -> None:
    if invitation_is_expired(invited_at, ttl_days):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="INVITATION_EXPIRED",
        )


# ---------------------------------------------------------------------------
# Read-side capability flags — single source of truth for the portal UI
# ---------------------------------------------------------------------------


async def compute_member_capabilities(
    session: AsyncSession,
    organization_id: UUID,
    members: list[tuple[OrganizationMember, User]],
) -> dict[UUID, MemberCapabilities]:
    """Per-member action flags. Same logic as the asserts above, evaluated
    against the current DB snapshot (no lock — this is a read).

    The "removal cascade owns projects" check is NOT included here; the
    portal calls a separate per-user endpoint only when the admin clicks
    Remove, because scanning every member's owned projects for every list
    render would be wasteful on large orgs.
    """
    surviving = await _surviving_admin_ids(session, organization_id, lock=False)

    out: dict[UUID, MemberCapabilities] = {}
    for member, user in members:
        is_last_admin = (
            user.id in surviving
            and len(surviving) == 1
        )
        # Demote: only meaningful if the member is currently an admin.
        # Blocked when they're the last surviving admin.
        can_demote = member.is_org_admin and not is_last_admin
        # Suspend: pending and active rows can be suspended. Blocked if
        # suspending would remove them from the surviving set AND they're
        # the only one in it. Suspended status itself still satisfies the
        # invariant, so suspending an admin is allowed if user.is_active.
        # Only flag false if the row IS in the surviving set and removing
        # it (via deactivation downstream) would empty it.
        can_suspend = member.status in (
            OrganizationMemberStatus.pending,
            OrganizationMemberStatus.active,
        )
        # Remove: cannot remove the last surviving admin.
        can_remove = member.status != OrganizationMemberStatus.removed and not is_last_admin

        out[user.id] = MemberCapabilities(
            is_last_admin=is_last_admin,
            can_remove=can_remove,
            can_demote=can_demote,
            can_suspend=can_suspend,
        )
    return out
