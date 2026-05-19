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

from bimstitch_api.models.organization import Organization
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)


async def count_consumed_seats(session: AsyncSession, organization_id: UUID) -> int:
    """Number of seats currently allocated. `removed` rows are tombstones and
    do NOT count; everything else (pending/active/suspended) does.
    """
    stmt = (
        select(func.count(OrganizationMember.id))
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.status != OrganizationMemberStatus.removed,
        )
    )
    result = await session.execute(stmt)
    return int(result.scalar_one() or 0)


async def assert_seat_available(
    session: AsyncSession, organization: Organization
) -> None:
    """Raise 409 SEAT_LIMIT_EXCEEDED if adding one more seat would exceed
    the org's `seat_limit`. No-op when the limit is NULL (unlimited).
    """
    if organization.seat_limit is None:
        return
    used = await count_consumed_seats(session, organization.id)
    if used >= organization.seat_limit:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="SEAT_LIMIT_EXCEEDED",
        )
