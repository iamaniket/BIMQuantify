"""Endpoints for the invitation recipient.

An org admin (or super-admin) creates a pending `OrganizationMember` row.
The invitee — already a verified BIMstitch user — lists their pending
invites and either accepts (pending → active) or declines (pending →
removed). Accept does NOT allocate a new seat: pending already counted,
so this is a pure status flip plus an `accepted_at` stamp.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.admin.membership_rules import (
    ProposedChange,
    assert_invitation_not_expired,
    assert_last_admin_invariant,
    assert_no_owned_projects,
    invitation_expires_at,
)
from bimstitch_api.auth.fastapi_users import current_active_user
from bimstitch_api.config import get_settings
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
    expires_at: datetime
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
    response: Response,
    # Naturally small (pending invites for one user), but cap defensively.
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> list[InvitationRead]:
    base = (
        select(OrganizationMember, Organization, User)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .join(User, User.id == OrganizationMember.invited_by, isouter=True)
        .where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.status == OrganizationMemberStatus.pending,
            Organization.deleted_at.is_(None),
        )
    )
    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)
    stmt = base.order_by(OrganizationMember.invited_at.desc()).limit(limit).offset(offset)
    rows = (await session.execute(stmt)).all()
    settings = get_settings()
    return [
        InvitationRead(
            organization_id=org.id,
            organization_name=org.name,
            is_org_admin=m.is_org_admin,
            invited_at=m.invited_at,
            expires_at=invitation_expires_at(m.invited_at, settings.invitation_ttl_days),
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
    settings = get_settings()
    assert_invitation_not_expired(member.invited_at, settings.invitation_ttl_days)

    now = datetime.now(UTC)
    member.status = OrganizationMemberStatus.active
    member.accepted_at = now

    await audit.record_for_org(
        session,
        org.id,
        action="organization_member.accepted",
        resource_type="organization_member",
        resource_id=member.id,
        after={"organization_id": str(org.id)},
        actor_user_id=user.id,
        request=request,
    )
    await session.commit()

    # In-app notification (best-effort, after commit).
    from bimstitch_api.i18n import PLATFORM_DEFAULT_LOCALE, t
    from bimstitch_api.models.notification import NotificationEventType
    from bimstitch_api.notifications.service import emit_notification_for_org

    display_name = user.full_name or user.email
    # Org-level event — platform default until Organization.default_locale lands.
    locale = PLATFORM_DEFAULT_LOCALE
    await emit_notification_for_org(
        organization_id=org.id,
        event_type=NotificationEventType.invitation_accepted,
        title=t("notifications.invitation_accepted.title", locale),
        body=t(
            "notifications.invitation_accepted.body",
            locale,
            display_name=display_name,
            org_name=org.name,
        ),
    )

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
    # declined (vs being silently dropped). Pending admin invites don't
    # count toward the last-admin invariant (see membership_rules), so
    # declining one can never leave the org headless.
    before = {"status": member.status.value}
    member.status = OrganizationMemberStatus.removed

    await audit.record_for_org(
        session,
        org.id,
        action="organization_member.declined",
        resource_type="organization_member",
        resource_id=member.id,
        before=before,
        after={"status": member.status.value},
        actor_user_id=user.id,
        request=request,
    )
    await session.commit()


# ---------------------------------------------------------------------------
# Leave organization (self-departure)
# ---------------------------------------------------------------------------


leave_router = APIRouter(prefix="/me/memberships", tags=["memberships"])


class LeaveOrgRequest(BaseModel):
    """Body for `POST /me/memberships/{org_id}/leave`.

    `reassign_to` is required when the leaving user owns one or more
    projects. The server returns `OWNS_ACTIVE_PROJECTS` with the list of
    project ids when it's missing.
    """

    reassign_to: UUID | None = None


@leave_router.post(
    "/{organization_id}/leave",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def leave_organization(
    organization_id: UUID,
    request: Request,
    payload: LeaveOrgRequest | None = None,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> None:
    """Self-departure. Tombstones the requester's membership row in this
    org after the last-admin invariant and owned-projects checks pass.
    The admin DELETE route refuses to act on self so all self-removal
    flows through here.
    """
    org = await session.get(Organization, organization_id)
    if org is None or org.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND")
    if org.status != OrganizationStatus.active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ORG_NOT_ACTIVE")

    member_q = await session.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.organization_id == organization_id,
        )
    )
    member = member_q.scalar_one_or_none()
    if member is None or member.status == OrganizationMemberStatus.removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="MEMBER_NOT_FOUND"
        )

    # Same invariants as admin removal — last admin can't leave, project
    # owners must reassign first.
    await assert_last_admin_invariant(
        session,
        organization_id,
        ProposedChange(
            user_id=user.id,
            new_status=OrganizationMemberStatus.removed,
            new_is_admin=member.is_org_admin,
        ),
    )
    reassign_to = payload.reassign_to if payload is not None else None
    await assert_no_owned_projects(session, org, user.id, reassign_to)

    before = {"is_org_admin": member.is_org_admin, "status": member.status.value}

    # Drop project_members rows for this user in the org's schema (owner
    # rows have already been transferred above if applicable).
    await session.execute(text(f'SET LOCAL search_path = "{org.schema_name}", public'))
    await session.execute(
        text("DELETE FROM project_members WHERE user_id = :uid"),
        {"uid": str(user.id)},
    )
    await session.execute(text("SET LOCAL search_path = public"))

    member.status = OrganizationMemberStatus.removed

    # Clear `active_organization_id` if the user was active in the org
    # they just left, so the next login picks a different one (or none).
    if user.active_organization_id == organization_id:
        user.active_organization_id = None

    await audit.record_for_org(
        session,
        organization_id,
        action="organization_member.left",
        resource_type="organization_member",
        resource_id=member.id,
        before=before,
        after={"reassigned_to": str(reassign_to)} if reassign_to else None,
        actor_user_id=user.id,
        request=request,
    )
    await session.commit()
