"""Org-admin endpoints for managing memberships.

Note: invite operates on BOTH master (`organization_members`) and tenant
(`project_members` in the target org's schema). The router sets
`search_path` explicitly inside a single transaction so both inserts
roll back together if anything fails.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.admin.membership_rules import (
    MemberCapabilities,
    ProposedChange,
    assert_last_admin_invariant,
    assert_no_owned_projects,
    assert_not_self_action,
    assert_org_mutable,
    assert_valid_status_transition,
    compute_member_capabilities,
    invitation_expires_at,
)
from bimstitch_api.admin.seats import assert_seat_available
from bimstitch_api.auth.dependencies import require_org_admin
from bimstitch_api.auth.manager import UserManager, get_user_manager
from bimstitch_api.config import get_settings
from bimstitch_api.db import get_async_session
from bimstitch_api.email.invites import send_invite_notification
from bimstitch_api.models.audit_log import AuditLog
from bimstitch_api.models.organization import Organization
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.project_member import ProjectRole
from bimstitch_api.models.user import User
from bimstitch_api.schemas.admin import (
    AuditEntry,
    MemberDelete,
    MemberGuestUpdate,
    MemberInvite,
    MemberRead,
    MemberUpdate,
)


def _build_member_read(
    member: OrganizationMember,
    user: User,
    caps: MemberCapabilities | None = None,
) -> MemberRead:
    """Single place that constructs `MemberRead`. `caps` is None for the
    invite/PATCH responses where the per-member capability flags aren't
    re-computed (the portal refetches the list anyway).
    """
    settings = get_settings()
    expires_at = None
    if member.status == OrganizationMemberStatus.pending:
        expires_at = invitation_expires_at(member.invited_at, settings.invitation_ttl_days)
    if caps is None:
        return MemberRead(
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_org_admin=member.is_org_admin,
            is_guest=member.is_guest,
            status=member.status.value,
            invited_at=member.invited_at,
            accepted_at=member.accepted_at,
            expires_at=expires_at,
        )
    return MemberRead(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_org_admin=member.is_org_admin,
        is_guest=member.is_guest,
        status=member.status.value,
        invited_at=member.invited_at,
        accepted_at=member.accepted_at,
        expires_at=expires_at,
        is_last_admin=caps.is_last_admin,
        can_remove=caps.can_remove,
        can_demote=caps.can_demote,
        can_suspend=caps.can_suspend,
    )

router = APIRouter(prefix="/organizations", tags=["organization-members"])


async def _load_org_or_404(session: AsyncSession, org_id: UUID) -> Organization:
    org = await session.get(Organization, org_id)
    if org is None or org.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND")
    return org


@router.get("/{organization_id}/members", response_model=list[MemberRead])
async def list_members(
    organization_id: UUID,
    requester: User = Depends(require_org_admin),
    session: AsyncSession = Depends(get_async_session),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[MemberRead]:
    stmt = (
        select(OrganizationMember, User)
        .join(User, User.id == OrganizationMember.user_id)
        .where(OrganizationMember.organization_id == organization_id)
        .order_by(User.email.asc())
        .limit(limit)
        .offset(offset)
    )
    if status_filter:
        stmt = stmt.where(OrganizationMember.status == OrganizationMemberStatus(status_filter))

    result = await session.execute(stmt)
    rows = result.all()
    caps_by_user = await compute_member_capabilities(session, organization_id, rows)
    return [_build_member_read(m, u, caps_by_user.get(u.id)) for m, u in rows]


@router.post(
    "/{organization_id}/members",
    response_model=MemberRead,
    status_code=status.HTTP_201_CREATED,
)
async def invite_member(
    organization_id: UUID,
    payload: MemberInvite,
    request: Request,
    requester: User = Depends(require_org_admin),
    session: AsyncSession = Depends(get_async_session),
    user_manager: UserManager = Depends(get_user_manager),
) -> MemberRead:
    org = await _load_org_or_404(session, organization_id)
    assert_org_mutable(org)
    schema = org.schema_name

    # Validate project roles up front (so a bad payload doesn't half-commit).
    for assignment in payload.projects:
        try:
            role_enum = ProjectRole(assignment.role)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"INVALID_PROJECT_ROLE: {assignment.role}",
            )
        # Owner is reserved for project creators. It can't be assigned via
        # invite (mirrors the rejection at projects.py::add_member); for
        # guests the rule is even stricter — they never get owner.
        if role_enum is ProjectRole.owner:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "GUEST_CANNOT_BE_OWNER"
                    if payload.is_guest
                    else "OWNER_ROLE_NOT_ASSIGNABLE"
                ),
            )

    # find-or-create user (case-insensitive)
    normalized = payload.email.strip().lower()
    stmt = select(User).where(func.lower(User.email) == normalized)
    existing = (await session.execute(stmt)).scalar_one_or_none()

    # Look up an existing membership (if any) BEFORE creating the user, so we
    # can short-circuit on duplicates without leaving an orphan user row.
    existing_m = None
    if existing is not None:
        existing_member_q = await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == existing.id,
                OrganizationMember.organization_id == organization_id,
            )
        )
        existing_m = existing_member_q.scalar_one_or_none()
        if existing_m is not None and existing_m.status != OrganizationMemberStatus.removed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="ORG_MEMBER_ALREADY_EXISTS",
            )

    # Seat-cap check. A fresh invite or a re-activation of a `removed` member
    # would consume a seat; the count excludes removed rows so the check is
    # accurate at this point. Guests are billed against their home org, so
    # they bypass the cap on the host org's side.
    if not payload.is_guest:
        await assert_seat_available(session, org)

    activation_required = False
    if existing is None:
        # Fresh user — create via UserManager so the verify-email side
        # effect fires (sends activation link).
        import secrets

        from fastapi_users.password import PasswordHelper

        new_user = User(
            email=payload.email,
            hashed_password=PasswordHelper().hash(secrets.token_hex(32)),
            full_name=payload.full_name,
            is_active=True,
            is_verified=False,
            is_superuser=False,
        )
        session.add(new_user)
        await session.flush()
        target_user = new_user
        activation_required = True
    else:
        target_user = existing

    # Re-use a removed row if present; else insert fresh
    if existing_m is not None:
        existing_m.status = OrganizationMemberStatus.pending
        existing_m.is_org_admin = payload.is_org_admin
        existing_m.is_guest = payload.is_guest
        existing_m.invited_at = datetime.now(UTC)
        existing_m.invited_by = requester.id
        existing_m.accepted_at = None
        member = existing_m
    else:
        member = OrganizationMember(
            user_id=target_user.id,
            organization_id=organization_id,
            is_org_admin=payload.is_org_admin,
            is_guest=payload.is_guest,
            status=OrganizationMemberStatus.pending,
            invited_by=requester.id,
        )
        session.add(member)
        await session.flush()

    # Project assignments in the target org's schema. We set search_path
    # so unqualified `project_members` resolves to the tenant schema.
    if payload.projects:
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        for assignment in payload.projects:
            # Verify the project exists in this org before inserting.
            check = await session.execute(
                text("SELECT 1 FROM projects WHERE id = :pid"),
                {"pid": str(assignment.project_id)},
            )
            if check.scalar_one_or_none() is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"PROJECT_NOT_FOUND: {assignment.project_id}",
                )
            await session.execute(
                text(
                    "INSERT INTO project_members (project_id, user_id, role) "
                    "VALUES (:pid, :uid, :role) "
                    "ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role"
                ),
                {
                    "pid": str(assignment.project_id),
                    "uid": str(target_user.id),
                    "role": assignment.role,
                },
            )
        # Restore search_path so any subsequent statement in this txn
        # writes audit_log to public, not the tenant schema.
        await session.execute(text("SET LOCAL search_path = public"))

    await audit.record(
        session,
        action="organization_member.invited",
        resource_type="organization_member",
        resource_id=member.id,
        after={
            "user_id": str(target_user.id),
            "email": target_user.email,
            "is_org_admin": payload.is_org_admin,
            "is_guest": payload.is_guest,
            "project_assignments": [
                {"project_id": str(a.project_id), "role": a.role} for a in payload.projects
            ],
        },
        actor_user_id=requester.id,
        organization_id=organization_id,
        request=request,
    )

    # Commit-equivalent: the session has autoflush + the caller's surrounding
    # `async with session.begin()` won't be there because this is the route
    # — so we commit explicitly.
    await session.commit()

    # Send invite email after commit so a flaky SMTP doesn't roll back the
    # invite. New users get the activation flow (`request_verify` triggers
    # `on_after_request_verify`); existing verified users get the
    # notification email and accept via /me/invitations.
    if activation_required:
        await user_manager.request_verify(target_user, request)
    else:
        await send_invite_notification(
            invitee=target_user,
            organization=org,
            inviter_email=requester.email,
        )

    return _build_member_read(member, target_user)


@router.patch(
    "/{organization_id}/members/{user_id}",
    response_model=MemberRead,
)
async def update_member(
    organization_id: UUID,
    user_id: UUID,
    payload: MemberUpdate,
    request: Request,
    requester: User = Depends(require_org_admin),
    session: AsyncSession = Depends(get_async_session),
) -> MemberRead:
    # Refuse mutations on suspended/deleted orgs before we read anything else.
    org = await _load_org_or_404(session, organization_id)
    assert_org_mutable(org)
    # The admin PATCH route is for acting on *other* members; self-changes go
    # through `/me/memberships/{org_id}/leave`.
    assert_not_self_action(requester.id, user_id)

    member = await session.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == organization_id,
        )
    )
    m = member.scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MEMBER_NOT_FOUND")

    before = {"is_org_admin": m.is_org_admin, "status": m.status.value}

    # Determine the post-mutation row state — we need this for both the
    # state-machine guard and the last-admin invariant before we touch any
    # column on the in-memory object.
    proposed_status = (
        OrganizationMemberStatus(payload.status) if payload.status is not None else m.status
    )
    proposed_is_admin = (
        payload.is_org_admin if payload.is_org_admin is not None else m.is_org_admin
    )

    assert_valid_status_transition(m.status, proposed_status)
    await assert_last_admin_invariant(
        session,
        organization_id,
        ProposedChange(
            user_id=user_id,
            new_status=proposed_status,
            new_is_admin=proposed_is_admin,
        ),
    )

    actions: list[str] = []
    if proposed_is_admin != m.is_org_admin:
        m.is_org_admin = proposed_is_admin
        actions.append("organization_member.role_changed")
    if proposed_status != m.status:
        m.status = proposed_status
        actions.append("organization_member.status_changed")

    if not actions:
        user = await session.get(User, user_id)
        assert user is not None
        return _build_member_read(m, user)

    await audit.record(
        session,
        action=actions[0] if len(actions) == 1 else "organization_member.role_changed",
        resource_type="organization_member",
        resource_id=m.id,
        before=before,
        after={"is_org_admin": m.is_org_admin, "status": m.status.value},
        actor_user_id=requester.id,
        organization_id=organization_id,
        request=request,
    )
    await session.commit()

    user = await session.get(User, user_id)
    assert user is not None
    return _build_member_read(m, user)


@router.patch(
    "/{organization_id}/members/{user_id}/guest",
    response_model=MemberRead,
)
async def update_member_guest(
    organization_id: UUID,
    user_id: UUID,
    payload: MemberGuestUpdate,
    request: Request,
    requester: User = Depends(require_org_admin),
    session: AsyncSession = Depends(get_async_session),
) -> MemberRead:
    """Toggle a member's guest flag.

    Promotion (guest -> regular) is gated by the seat cap because a guest
    moving to regular membership consumes a seat. Demotion (regular ->
    guest) is rejected when the target is currently an org admin: the
    admin must be demoted via `PATCH /members/{user_id}` first, so the
    last-admin invariant has its own audit signal.
    """
    org = await _load_org_or_404(session, organization_id)
    assert_org_mutable(org)
    assert_not_self_action(requester.id, user_id)

    result = await session.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == organization_id,
        )
    )
    m = result.scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MEMBER_NOT_FOUND")

    if m.is_guest == payload.is_guest:
        user = await session.get(User, user_id)
        assert user is not None
        return _build_member_read(m, user)

    if payload.is_guest and m.is_org_admin:
        # Demoting an org admin to guest in one step would skip the
        # last-admin invariant. Force the admin to be demoted first.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="DEMOTE_ADMIN_BEFORE_GUEST",
        )

    if not payload.is_guest:
        # guest -> regular: the row now occupies a real seat.
        await assert_seat_available(session, org)

    before = {"is_guest": m.is_guest}
    m.is_guest = payload.is_guest

    await audit.record(
        session,
        action="organization_member.guest_changed",
        resource_type="organization_member",
        resource_id=m.id,
        before=before,
        after={"is_guest": m.is_guest},
        actor_user_id=requester.id,
        organization_id=organization_id,
        request=request,
    )
    await session.commit()

    user = await session.get(User, user_id)
    assert user is not None
    return _build_member_read(m, user)


@router.delete(
    "/{organization_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_member(
    organization_id: UUID,
    user_id: UUID,
    request: Request,
    payload: MemberDelete | None = None,
    requester: User = Depends(require_org_admin),
    session: AsyncSession = Depends(get_async_session),
) -> None:
    org = await _load_org_or_404(session, organization_id)
    assert_org_mutable(org)
    # Self-removal goes through /me/memberships/{org}/leave so its audit
    # entry and last-admin handling are distinct from "admin removes other".
    assert_not_self_action(requester.id, user_id)
    schema = org.schema_name

    member = await session.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == organization_id,
        )
    )
    m = member.scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MEMBER_NOT_FOUND")

    # Removing an admin must not leave the org headless.
    await assert_last_admin_invariant(
        session,
        organization_id,
        ProposedChange(
            user_id=user_id,
            new_status=None,
            new_is_admin=m.is_org_admin,
            deleted=True,
        ),
    )

    # If the user owns projects, the caller must pass `reassign_to`. The
    # helper transfers ownership in this same txn or raises 409
    # OWNS_ACTIVE_PROJECTS with the project ids so the portal can prompt.
    reassign_to = payload.reassign_to if payload is not None else None
    await assert_no_owned_projects(session, org, user_id, reassign_to)

    before = {"is_org_admin": m.is_org_admin, "status": m.status.value}

    # Drop any project_members rows in THIS org's schema only. Ownership
    # has already been transferred above (if applicable), so this only
    # removes non-owner project access.
    await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
    await session.execute(
        text("DELETE FROM project_members WHERE user_id = :uid"),
        {"uid": str(user_id)},
    )
    await session.execute(text("SET LOCAL search_path = public"))

    await session.delete(m)

    await audit.record(
        session,
        action="organization_member.removed",
        resource_type="organization_member",
        resource_id=m.id,
        before=before,
        after={"reassigned_to": str(reassign_to)} if reassign_to else None,
        actor_user_id=requester.id,
        organization_id=organization_id,
        request=request,
    )
    await session.commit()


@router.post(
    "/{organization_id}/members/{user_id}/resend-invite",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def resend_invite(
    organization_id: UUID,
    user_id: UUID,
    request: Request,
    requester: User = Depends(require_org_admin),
    session: AsyncSession = Depends(get_async_session),
    user_manager: UserManager = Depends(get_user_manager),
) -> None:
    org = await _load_org_or_404(session, organization_id)
    assert_org_mutable(org)

    member_q = await session.execute(
        select(OrganizationMember, User)
        .join(User, User.id == OrganizationMember.user_id)
        .where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == organization_id,
        )
    )
    row = member_q.first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MEMBER_NOT_FOUND")
    member, user = row
    if member.status != OrganizationMemberStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="MEMBER_NOT_PENDING",
        )

    # Reset the invite clock so the expiry sweeper doesn't reap a row the
    # admin is actively re-poking. Audit the bump so timeline reconstruction
    # stays accurate.
    before_invited_at = member.invited_at
    member.invited_at = datetime.now(UTC)
    await audit.record(
        session,
        action="organization_member.invite_resent",
        resource_type="organization_member",
        resource_id=member.id,
        before={"invited_at": before_invited_at.isoformat()},
        after={"invited_at": member.invited_at.isoformat()},
        actor_user_id=requester.id,
        organization_id=organization_id,
        request=request,
    )
    await session.commit()

    if not user.is_verified:
        # Account never activated — re-send activation token.
        await user_manager.request_verify(user, request)
    else:
        # Verified user with a pending membership — re-send the
        # accept/decline notification.
        await send_invite_notification(
            invitee=user,
            organization=org,
            inviter_email=requester.email,
        )


# ---------------------------------------------------------------------------
# Org-scoped audit log (org admin sees their org's entries)
# ---------------------------------------------------------------------------


@router.get(
    "/{organization_id}/audit-log",
    response_model=list[AuditEntry],
)
async def list_org_audit_log(
    organization_id: UUID,
    requester: User = Depends(require_org_admin),
    session: AsyncSession = Depends(get_async_session),
    action: str | None = None,
    resource_type: str | None = None,
    user_id: UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[AuditEntry]:
    stmt = (
        select(AuditLog)
        .where(AuditLog.organization_id == organization_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if since:
        stmt = stmt.where(AuditLog.created_at >= since)
    if until:
        stmt = stmt.where(AuditLog.created_at < until)
    result = await session.execute(stmt)
    return [AuditEntry.model_validate(e, from_attributes=True) for e in result.scalars()]
