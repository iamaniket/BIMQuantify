"""Small read-side guards shared across routers.

Living here (rather than in `dependencies.py`) so router code can call
these inline as plain async functions without dragging a FastAPI Depends
indirection through every helper. Each guard takes the session the
caller is already using.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)


async def is_guest_member(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> bool:
    """True if the caller is an ACTIVE guest of the given org.

    Returns False for non-members, pending invites, suspended/removed
    rows, and regular (non-guest) memberships. Routers use this to gate
    org-wide listings and project creation for cross-org collaborators.
    """
    stmt = select(OrganizationMember.is_guest).where(
        OrganizationMember.user_id == user_id,
        OrganizationMember.organization_id == organization_id,
        OrganizationMember.status == OrganizationMemberStatus.active,
    )
    result = await session.execute(stmt)
    row = result.scalar_one_or_none()
    return bool(row)
