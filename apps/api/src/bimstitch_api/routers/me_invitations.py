"""Endpoints for the invitation recipient.

An org admin (or super-admin) creates a pending `OrganizationMember` row.
The invitee — already a verified BIMstitch user — lists their pending
invites and either accepts (pending → active) or declines (pending →
removed). Accept does NOT allocate a new seat: pending already counted,
so this is a pure status flip plus an `accepted_at` stamp.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.auth.fastapi_users import current_active_user
from bimstitch_api.db import get_async_session
from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User

router = APIRouter(prefix="/me/invitations", tags=["invitations"])


class InvitationRead(BaseModel):
    organization_id: UUID
    organization_name: str
    is_org_admin: bool
    invited_at: datetime
    invited_by_email: str | None


class InvitationAcceptResponse(BaseModel):
    organization_id: UUID
    status: str
    accepted_at: datetime


async def _load_pending(
    session: AsyncSession, user: User, organization_id: UUID
) -> tuple[OrganizationMember, Organization]:
    stmt = (
        select(OrganizationMember, Organization)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.status == OrganizationMemberStatus.pending,
        )
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="INVITATION_NOT_FOUND",
        )
    return row[0], row[1]


@router.get("", response_model=list[InvitationRead])
async def list_my_invitations(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> list[InvitationRead]:
    stmt = (
        select(OrganizationMember, Organization, User)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .join(User, User.id == OrganizationMember.invited_by, isouter=True)
        .where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.status == OrganizationMemberStatus.pending,
            Organization.deleted_at.is_(None),
        )
        .order_by(OrganizationMember.invited_at.desc())
    )
    rows = (await session.execute(stmt)).all()
    return [
        InvitationRead(
            organization_id=org.id,
            organization_name=org.name,
            is_org_admin=m.is_org_admin,
            invited_at=m.invited_at,
            invited_by_email=inviter.email if inviter is not None else None,
        )
        for m, org, inviter in rows
    ]


@router.post(
    "/{organization_id}/accept",
    response_model=InvitationAcceptResponse,
)
async def accept_invitation(
    organization_id: UUID,
    request: Request,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> InvitationAcceptResponse:
    member, org = await _load_pending(session, user, organization_id)
    # Joining a suspended or soft-deleted org would leave the user with an
    # unusable membership. Refuse and let the user re-invite once the org
    # is back.
    if org.deleted_at is not None or org.status != OrganizationStatus.active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ORG_NOT_AVAILABLE",
        )

    now = datetime.now(timezone.utc)
    member.status = OrganizationMemberStatus.active
    member.accepted_at = now

    await audit.record(
        session,
        action="organization_member.accepted",
        resource_type="organization_member",
        resource_id=member.id,
        after={"organization_id": str(org.id)},
        actor_user_id=user.id,
        organization_id=org.id,
        request=request,
    )
    await session.commit()

    return InvitationAcceptResponse(
        organization_id=org.id,
        status=member.status.value,
        accepted_at=now,
    )


@router.post(
    "/{organization_id}/decline",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def decline_invitation(
    organization_id: UUID,
    request: Request,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> None:
    member, org = await _load_pending(session, user, organization_id)
    # Tombstone the row — frees the seat and tells the admin the user
    # declined (vs being silently dropped).
    before = {"status": member.status.value}
    member.status = OrganizationMemberStatus.removed

    await audit.record(
        session,
        action="organization_member.declined",
        resource_type="organization_member",
        resource_id=member.id,
        before=before,
        after={"status": member.status.value},
        actor_user_id=user.id,
        organization_id=org.id,
        request=request,
    )
    await session.commit()
