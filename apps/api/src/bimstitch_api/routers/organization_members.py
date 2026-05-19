"""Org-admin endpoints for managing memberships.

Note: invite operates on BOTH master (`organization_members`) and tenant
(`project_members` in the target org's schema). The router sets
`search_path` explicitly inside a single transaction so both inserts
roll back together if anything fails.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.admin.seats import assert_seat_available
from bimstitch_api.auth.dependencies import require_org_admin
from bimstitch_api.auth.manager import UserManager, get_user_manager
from bimstitch_api.db import get_async_session
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
    MemberInvite,
    MemberRead,
    MemberUpdate,
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
    return [
        MemberRead(
            user_id=u.id,
            email=u.email,
            full_name=u.full_name,
            is_org_admin=m.is_org_admin,
            status=m.status.value,
            invited_at=m.invited_at,
            accepted_at=m.accepted_at,
        )
        for m, u in result.all()
    ]


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
    schema = org.schema_name

    # Validate project roles up front (so a bad payload doesn't half-commit).
    for assignment in payload.projects:
        try:
            ProjectRole(assignment.role)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"INVALID_PROJECT_ROLE: {assignment.role}",
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
    # accurate at this point.
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
        existing_m.invited_at = datetime.now(timezone.utc)
        existing_m.invited_by = requester.id
        existing_m.accepted_at = None
        member = existing_m
    else:
        member = OrganizationMember(
            user_id=target_user.id,
            organization_id=organization_id,
            is_org_admin=payload.is_org_admin,
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

    # Send activation email after commit so a flaky SMTP doesn't roll back
    # the invite. `request_verify` triggers `on_after_request_verify` which
    # uses the configured email transport.
    if activation_required:
        await user_manager.request_verify(target_user, request)

    return MemberRead(
        user_id=target_user.id,
        email=target_user.email,
        full_name=target_user.full_name,
        is_org_admin=member.is_org_admin,
        status=member.status.value,
        invited_at=member.invited_at,
        accepted_at=member.accepted_at,
    )


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
    # `require_org_admin` already issued a SELECT → session has an auto-begun
    # transaction. Skip the explicit `session.begin()` to avoid double-begin.
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
    actions: list[str] = []
    if payload.is_org_admin is not None and payload.is_org_admin != m.is_org_admin:
        m.is_org_admin = payload.is_org_admin
        actions.append("organization_member.role_changed")
    if payload.status is not None:
        new_status = OrganizationMemberStatus(payload.status)
        if new_status != m.status:
            m.status = new_status
            actions.append("organization_member.status_changed")

    if not actions:
        user = await session.get(User, user_id)
        assert user is not None
        return MemberRead(
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_org_admin=m.is_org_admin,
            status=m.status.value,
            invited_at=m.invited_at,
            accepted_at=m.accepted_at,
        )

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
    return MemberRead(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_org_admin=m.is_org_admin,
        status=m.status.value,
        invited_at=m.invited_at,
        accepted_at=m.accepted_at,
    )


@router.delete(
    "/{organization_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_member(
    organization_id: UUID,
    user_id: UUID,
    request: Request,
    requester: User = Depends(require_org_admin),
    session: AsyncSession = Depends(get_async_session),
) -> None:
    org = await _load_org_or_404(session, organization_id)
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

    before = {"is_org_admin": m.is_org_admin, "status": m.status.value}

    # Remove any project_members rows in THIS org's schema only.
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
    if not user.is_verified:
        await user_manager.request_verify(user, request)


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
