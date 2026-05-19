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
from bimstitch_api.auth.dependencies import require_superuser
from bimstitch_api.db import get_async_session
from bimstitch_api.models.audit_log import AuditLog
from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.user import User
from bimstitch_api.schemas.admin import (
    AdminUserRead,
    AuditEntry,
    OrganizationCreate,
    OrganizationCreateResponse,
    OrganizationRead,
    OrganizationUpdate,
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
) -> OrganizationCreateResponse:
    try:
        result = await provision_organization(
            name=payload.name,
            admin_email=payload.admin_email,
            admin_full_name=payload.admin_full_name,
            requester=requester,
            request=request,
        )
    except ProvisioningError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PROVISIONING_FAILED: {exc}",
        ) from exc

    return OrganizationCreateResponse(
        organization=OrganizationRead.model_validate(result.organization, from_attributes=True),
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
    return [OrganizationRead.model_validate(o, from_attributes=True) for o in result.scalars()]


@router.get("/organizations/{organization_id}", response_model=OrganizationRead)
async def get_organization(
    organization_id: UUID,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
) -> OrganizationRead:
    org = await session.get(Organization, organization_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND")
    return OrganizationRead.model_validate(org, from_attributes=True)


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

    before = {"name": org.name, "status": org.status.value}
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
        }
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

    return OrganizationRead.model_validate(org, from_attributes=True)


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
