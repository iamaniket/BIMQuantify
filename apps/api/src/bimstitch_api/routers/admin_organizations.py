"""Super-admin endpoints for managing organizations and users.

All routes here require `is_superuser=true`. They operate on the master
schema directly (no `search_path` tweaking) — that's the whole point of
the super-admin role.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.admin.provisioning import (
    ProvisioningError,
    delete_organization,
    provision_organization,
)
from bimstitch_api.admin.seats import count_consumed_seats
from bimstitch_api.auth.dependencies import require_superuser
from bimstitch_api.db import get_async_session
from bimstitch_api.models.audit_log import AuditLog
from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.schemas.admin import (
    AdminUserRead,
    AuditEntry,
    OrganizationCreate,
    OrganizationCreateResponse,
    OrganizationRead,
    OrganizationUpdate,
)


async def _seat_counts_for(
    session: AsyncSession, organization_ids: list[UUID]
) -> dict[UUID, int]:
    """Bulk seat-usage lookup. Returns {org_id: consumed_seats}. Orgs with no
    members are omitted from the dict; callers should default to 0.
    """
    if not organization_ids:
        return {}
    stmt = (
        select(
            OrganizationMember.organization_id,
            func.count(OrganizationMember.id),
        )
        .where(
            OrganizationMember.organization_id.in_(organization_ids),
            OrganizationMember.status != OrganizationMemberStatus.removed,
        )
        .group_by(OrganizationMember.organization_id)
    )
    result = await session.execute(stmt)
    return {row[0]: int(row[1]) for row in result.all()}


def _serialize_org(org: Organization, seat_count_used: int) -> OrganizationRead:
    return OrganizationRead(
        id=org.id,
        name=org.name,
        schema_name=org.schema_name,
        status=org.status.value,
        seat_limit=org.seat_limit,
        seat_count_used=seat_count_used,
        created_at=org.created_at,
        provisioned_at=org.provisioned_at,
        deleted_at=org.deleted_at,
    )

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------


@router.post(
    "/organizations",
    response_model=OrganizationCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_organization(
    payload: OrganizationCreate,
    request: Request,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
) -> OrganizationCreateResponse:
    try:
        result = await provision_organization(
            name=payload.name,
            admin_email=payload.admin_email,
            admin_full_name=payload.admin_full_name,
            seat_limit=payload.seat_limit,
            requester=requester,
            request=request,
        )
    except ProvisioningError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PROVISIONING_FAILED: {exc}",
        ) from exc

    seat_count = await count_consumed_seats(session, result.organization.id)
    return OrganizationCreateResponse(
        organization=_serialize_org(result.organization, seat_count),
        admin_user_id=result.admin.id,
        admin_email=result.admin.email,
        activation_required=result.activation_required,
    )


@router.get("/organizations", response_model=list[OrganizationRead])
async def list_organizations(
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = None,
    include_deleted: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[OrganizationRead]:
    stmt = select(Organization).order_by(Organization.created_at.desc())
    if not include_deleted:
        stmt = stmt.where(Organization.deleted_at.is_(None))
    if status_filter:
        stmt = stmt.where(Organization.status == OrganizationStatus(status_filter))
    if q:
        stmt = stmt.where(func.lower(Organization.name).like(f"%{q.lower()}%"))
    stmt = stmt.limit(limit).offset(offset)
    result = await session.execute(stmt)
    orgs = list(result.scalars())
    seats = await _seat_counts_for(session, [o.id for o in orgs])
    return [_serialize_org(o, seats.get(o.id, 0)) for o in orgs]


@router.get("/organizations/{organization_id}", response_model=OrganizationRead)
async def get_organization(
    organization_id: UUID,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
) -> OrganizationRead:
    org = await session.get(Organization, organization_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND")
    seat_count = await count_consumed_seats(session, organization_id)
    return _serialize_org(org, seat_count)


@router.patch("/organizations/{organization_id}", response_model=OrganizationRead)
async def update_organization(
    organization_id: UUID,
    payload: OrganizationUpdate,
    request: Request,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
) -> OrganizationRead:
    # `require_superuser` already issued queries → session has an auto-begun
    # transaction. Write directly + commit at the end; the dependency teardown
    # will roll back any uncommitted state on raise.
    org = await session.get(Organization, organization_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND")

    fields_set = payload.model_fields_set
    before = {
        "name": org.name,
        "status": org.status.value,
        "seat_limit": org.seat_limit,
    }
    updates: dict = {}
    action = "organization.updated"
    if payload.name is not None and payload.name != org.name:
        updates["name"] = payload.name
    if payload.status is not None:
        new_status = OrganizationStatus(payload.status)
        if new_status not in (OrganizationStatus.active, OrganizationStatus.suspended):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="ORG_STATUS_NOT_TRANSITIONABLE",
            )
        if new_status != org.status:
            updates["status"] = new_status
            action = (
                "organization.suspended"
                if new_status == OrganizationStatus.suspended
                else "organization.updated"
            )

    # `seat_limit` distinguishes "omitted" from "explicit null". `model_fields_set`
    # only contains keys present in the request body, so a null clears the cap
    # and an absent key leaves it alone.
    seat_limit_changed = False
    if "seat_limit" in fields_set and payload.seat_limit != org.seat_limit:
        if payload.seat_limit is not None:
            used = await count_consumed_seats(session, organization_id)
            if payload.seat_limit < used:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="SEAT_LIMIT_BELOW_USAGE",
                )
        updates["seat_limit"] = payload.seat_limit
        seat_limit_changed = True

    if updates:
        await session.execute(
            update(Organization)
            .where(Organization.id == organization_id)
            .values(**updates)
        )
        refreshed = await session.get(Organization, organization_id)
        assert refreshed is not None
        after = {
            "name": refreshed.name,
            "status": refreshed.status.value,
            "seat_limit": refreshed.seat_limit,
        }
        # If both status and seat_limit changed, prefer the more specific action.
        if seat_limit_changed and "status" not in updates and "name" not in updates:
            action = "organization.seat_limit_changed"
        elif seat_limit_changed:
            # Record an extra audit entry so the seat change is visible
            # even though the primary action describes name/status.
            await audit.record(
                session,
                action="organization.seat_limit_changed",
                resource_type="organization",
                resource_id=organization_id,
                before={"seat_limit": before["seat_limit"]},
                after={"seat_limit": after["seat_limit"]},
                actor_user_id=requester.id,
                organization_id=organization_id,
                request=request,
            )
        await audit.record(
            session,
            action=action,
            resource_type="organization",
            resource_id=organization_id,
            before=before,
            after=after,
            actor_user_id=requester.id,
            organization_id=organization_id,
            request=request,
        )
        await session.commit()
        org = refreshed

    seat_count = await count_consumed_seats(session, organization_id)
    return _serialize_org(org, seat_count)


@router.delete("/organizations/{organization_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org(
    organization_id: UUID,
    request: Request,
    requester: User = Depends(require_superuser),
) -> None:
    await delete_organization(
        organization_id=organization_id,
        requester=requester,
        request=request,
    )


# ---------------------------------------------------------------------------
# Users (global search + superuser toggle)
# ---------------------------------------------------------------------------


@router.get("/users", response_model=list[AdminUserRead])
async def list_users(
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    q: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[AdminUserRead]:
    stmt = select(User).order_by(User.email.asc()).limit(limit).offset(offset)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(func.lower(User.email).like(like), func.lower(User.full_name).like(like))
        )
    result = await session.execute(stmt)
    return [AdminUserRead.model_validate(u, from_attributes=True) for u in result.scalars()]


async def _toggle_superuser(
    user_id: UUID,
    new_value: bool,
    requester: User,
    session: AsyncSession,
    request: Request,
) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="USER_NOT_FOUND")
    if user.is_superuser == new_value:
        return user
    user.is_superuser = new_value
    await audit.record(
        session,
        action="user.promoted_superuser" if new_value else "user.demoted_superuser",
        resource_type="user",
        resource_id=user.id,
        before={"is_superuser": (not new_value)},
        after={"is_superuser": new_value},
        actor_user_id=requester.id,
        request=request,
    )
    return user


@router.post("/users/{user_id}/promote", response_model=AdminUserRead)
async def promote_user(
    user_id: UUID,
    request: Request,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
) -> AdminUserRead:
    user = await _toggle_superuser(user_id, True, requester, session, request)
    await session.commit()
    return AdminUserRead.model_validate(user, from_attributes=True)


@router.post("/users/{user_id}/demote", response_model=AdminUserRead)
async def demote_user(
    user_id: UUID,
    request: Request,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
) -> AdminUserRead:
    user = await _toggle_superuser(user_id, False, requester, session, request)
    await session.commit()
    return AdminUserRead.model_validate(user, from_attributes=True)


async def _toggle_active(
    user_id: UUID,
    new_value: bool,
    requester: User,
    session: AsyncSession,
    request: Request,
) -> User:
    """Flip `users.is_active`. FastAPI Users' login check rejects inactive
    users at the credentials step, so a deactivated user can't get a new
    token. Existing tokens still pass authentication until they expire (no
    revocation here — token TTLs are short and refresh re-checks the
    underlying user row, which will now fail).
    """
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="USER_NOT_FOUND")
    if user.is_active == new_value:
        return user
    if not new_value and user.id == requester.id:
        # A super-admin deactivating themselves would lock the platform out
        # of admin actions until someone else flips them back. Block it.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CANNOT_DEACTIVATE_SELF",
        )
    user.is_active = new_value
    await audit.record(
        session,
        action="user.activated" if new_value else "user.deactivated",
        resource_type="user",
        resource_id=user.id,
        before={"is_active": (not new_value)},
        after={"is_active": new_value},
        actor_user_id=requester.id,
        request=request,
    )
    return user


@router.post("/users/{user_id}/activate", response_model=AdminUserRead)
async def activate_user(
    user_id: UUID,
    request: Request,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
) -> AdminUserRead:
    user = await _toggle_active(user_id, True, requester, session, request)
    await session.commit()
    return AdminUserRead.model_validate(user, from_attributes=True)


@router.post("/users/{user_id}/deactivate", response_model=AdminUserRead)
async def deactivate_user(
    user_id: UUID,
    request: Request,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
) -> AdminUserRead:
    user = await _toggle_active(user_id, False, requester, session, request)
    await session.commit()
    return AdminUserRead.model_validate(user, from_attributes=True)


# ---------------------------------------------------------------------------
# Audit log — super-admin global view
# ---------------------------------------------------------------------------


@router.get("/audit-log", response_model=list[AuditEntry])
async def list_audit_log(
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    action: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    user_id: UUID | None = None,
    organization_id: UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[AuditEntry]:
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if resource_id:
        stmt = stmt.where(AuditLog.resource_id == resource_id)
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if organization_id:
        stmt = stmt.where(AuditLog.organization_id == organization_id)
    if since:
        stmt = stmt.where(AuditLog.created_at >= since)
    if until:
        stmt = stmt.where(AuditLog.created_at < until)
    result = await session.execute(stmt)
    return [AuditEntry.model_validate(e, from_attributes=True) for e in result.scalars()]
