"""Seat allocation helpers.

`seat_limit` on `Organization` is the cap; "consumed" seats are members whose
status is anything other than `removed`. Pending invites count — otherwise a
flood of pending invites could quietly exceed the cap once they accept.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.models.organization import Organization
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)


async def count_consumed_seats(session: AsyncSession, organization_id: UUID) -> int:
    """Number of seats currently allocated. `removed` rows are tombstones and
    do NOT count; guests (`is_guest=true`) do NOT count either — they are
    cross-org collaborators billed against their home org. Everything else
    (pending/active/suspended regular members) does.
    """
    stmt = (
        select(func.count(OrganizationMember.id))
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.status != OrganizationMemberStatus.removed,
            OrganizationMember.is_guest.is_(False),
        )
    )
    result = await session.execute(stmt)
    return int(result.scalar_one() or 0)


async def assert_seat_available(
    session: AsyncSession, organization: Organization, *, lock: bool = True
) -> None:
    """Raise 409 SEAT_LIMIT_EXCEEDED if adding one more seat would exceed
    the org's `seat_limit`. No-op when the limit is NULL (unlimited).

    `lock=True` (the default) takes a `SELECT ... FOR UPDATE` on the
    `Organization` row before counting, so two invites racing on the last
    free seat can't both read "room available" and both insert. The lock is
    held until the surrounding transaction commits — which, at every call
    site, is the same transaction that inserts/reactivates the member — so
    the count-then-insert is serialized per org. Without it the unlocked
    COUNT is a TOCTOU that over-provisions the org (a billing leak). Pass
    `lock=False` only for read-only seat probes outside a write path.
    Mirrors the `with_for_update` last-admin invariant in membership_rules.py.
    """
    if organization.seat_limit is None:
        return
    if lock:
        await session.execute(
            select(Organization.id)
            .where(Organization.id == organization.id)
            .with_for_update()
        )
    used = await count_consumed_seats(session, organization.id)
    if used >= organization.seat_limit:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="SEAT_LIMIT_EXCEEDED",
        )


async def assert_within_seat_limit(
    session: AsyncSession, organization: Organization
) -> None:
    """Raise 409 SEAT_LIMIT_EXCEEDED if the org is already OVER its
    `seat_limit` (consumed > limit). No-op when the limit is NULL (unlimited).

    Unlike `assert_seat_available`, this does NOT reserve room for one more
    seat — the caller's seat is assumed already counted. Accepting a pending
    invite is seat-neutral (pending and active both count via
    `count_consumed_seats`), so the comparison is strict `>`: a normally full
    org (consumed == limit) passes, and only a genuinely over-provisioned org
    is rejected. A naive `>=` here would 409 every legitimate acceptance at a
    full org.

    This is the backstop on the accept/activation path: the seat was reserved
    (and seat-checked, under lock) at invite time, but the cap could in theory
    have been breached since — a pre-fix invite race, or a cap lowered through
    a path that bypassed the usage guard. Read-only, no row lock: acceptance
    can't itself push the count over (seat-neutral), and the downgrade guard
    (`admin_organizations.py`) already refuses to lower the cap below the
    pending-inclusive consumed count.
    """
    if organization.seat_limit is None:
        return
    used = await count_consumed_seats(session, organization.id)
    if used > organization.seat_limit:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="SEAT_LIMIT_EXCEEDED",
        )
