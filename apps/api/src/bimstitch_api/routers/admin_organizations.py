"""Super-admin endpoints for managing organizations and users.

All routes here require `is_superuser=true`. They operate on the master
schema directly (no `search_path` tweaking) — that's the whole point of
the super-admin role.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.admin.membership_rules import (
    ProposedUserChange,
    assert_last_superuser_invariant,
)
from bimstitch_api.admin.provisioning import (
    ProvisioningError,
    ProvisionResult,
    delete_organization,
    provision_organization,
)
from bimstitch_api.admin.seats import count_consumed_seats
from bimstitch_api.admin.storage import (
    assert_storage_limit_not_below_usage,
    compute_active_storage_gb,
    compute_storage_gb_bulk,
)
from bimstitch_api.auth.dependencies import require_superuser
from bimstitch_api.auth.manager import UserManager, get_user_manager
from bimstitch_api.db import get_async_session, get_session_maker
from bimstitch_api.email.invites import send_invite_notification
from bimstitch_api.models.access_request import AccessRequest, AccessRequestStatus
from bimstitch_api.models.audit_log import AuditLog
from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.pagination import (
    SortParams,
    apply_sort,
    count_query,
    set_total_count,
    sort_params,
)
from bimstitch_api.schemas.admin import (
    AccessRequestAdminRead,
    AccessRequestApproveInput,
    AccessRequestApproveResponse,
    AdminUserRead,
    AuditEntry,
    OrganizationCreate,
    OrganizationCreateResponse,
    OrganizationRead,
    OrganizationUpdate,
)
from bimstitch_api.storage import StorageBackend, get_attachments_bucket, get_storage
from bimstitch_api.tenancy import resolve_platform_schema, schema_name_for

logger = logging.getLogger(__name__)


async def _dispatch_invite_email(
    *,
    result: ProvisionResult,
    user_manager: UserManager,
    requester_email: str,
    request: Request,
) -> bool:
    """Send the activation / invite notification email after provisioning.

    Returns True on success, False on failure. Failures are logged but never
    re-raised — a flaky SMTP must not strand callers in an inconsistent state.
    The admin can re-trigger via `POST /organizations/{org}/members/{user}/resend-invite`.
    """
    try:
        if result.activation_required:
            await user_manager.request_verify(result.admin, request)
        else:
            await send_invite_notification(
                invitee=result.admin,
                organization=result.organization,
                inviter_email=requester_email,
            )
        return True
    except Exception:  # noqa: BLE001 — best-effort side channel
        logger.exception(
            "invite_email_dispatch_failed admin_email=%s org=%s; "
            "admin can resend via /resend-invite",
            result.admin.email,
            result.organization.name,
        )
        return False


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


async def _serialize_org(
    org: Organization,
    seat_count_used: int,
    storage_used_gb: float,
    storage: StorageBackend,
) -> OrganizationRead:
    image_url: str | None = None
    if org.image_key:
        bucket = get_attachments_bucket()
        image_url = await storage.presigned_get_url(
            org.image_key, "org-logo", bucket=bucket,
        )
    return OrganizationRead(
        id=org.id,
        name=org.name,
        schema_name=org.schema_name,
        status=org.status.value,
        seat_limit=org.seat_limit,
        seat_count_used=seat_count_used,
        active_storage_limit_gb=org.active_storage_limit_gb,
        active_storage_used_gb=storage_used_gb,
        image_url=image_url,
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
    user_manager: UserManager = Depends(get_user_manager),
    storage: StorageBackend = Depends(get_storage),
) -> OrganizationCreateResponse:
    try:
        result = await provision_organization(
            name=payload.name,
            admin_email=payload.admin_email,
            admin_full_name=payload.admin_full_name,
            seat_limit=payload.seat_limit,
            active_storage_limit_gb=payload.active_storage_limit_gb,
            requester=requester,
            request=request,
        )
    except ProvisioningError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PROVISIONING_FAILED: {exc}",
        ) from exc

    # Dispatch invite email AFTER the saga has committed. A flaky SMTP must
    # not roll back a successfully-provisioned org — the admin can resend
    # via POST /organizations/{org}/members/{user}/resend-invite.
    await _dispatch_invite_email(
        result=result,
        user_manager=user_manager,
        requester_email=requester.email,
        request=request,
    )

    seat_count = await count_consumed_seats(session, result.organization.id)
    storage_gb = await compute_active_storage_gb(
        get_session_maker(), result.organization.schema_name,
    )
    return OrganizationCreateResponse(
        organization=await _serialize_org(
            result.organization, seat_count, storage_gb, storage,
        ),
        admin_user_id=result.admin.id,
        admin_email=result.admin.email,
        activation_required=result.activation_required,
    )


@router.get("/organizations", response_model=list[OrganizationRead])
async def list_organizations(
    response: Response,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = None,
    include_deleted: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort: SortParams = Depends(sort_params),
) -> list[OrganizationRead]:
    base = select(Organization)
    if not include_deleted:
        base = base.where(Organization.deleted_at.is_(None))
    if status_filter:
        base = base.where(Organization.status == OrganizationStatus(status_filter))
    if q:
        base = base.where(func.lower(Organization.name).like(f"%{q.lower()}%"))

    set_total_count(response, await count_query(session, base))
    stmt = apply_sort(
        base,
        sort,
        {
            "name": Organization.name,
            "status": Organization.status,
            "created_at": Organization.created_at,
        },
        default="created_at",
        default_dir="desc",
        tiebreaker=Organization.id,
    ).limit(limit).offset(offset)
    result = await session.execute(stmt)
    orgs = list(result.scalars())
    seats = await _seat_counts_for(session, [o.id for o in orgs])
    storage_usage = await compute_storage_gb_bulk(get_session_maker(), orgs)
    return await asyncio.gather(
        *[
            _serialize_org(o, seats.get(o.id, 0), storage_usage.get(o.id, 0.0), storage)
            for o in orgs
        ]
    )


@router.get("/organizations/{organization_id}", response_model=OrganizationRead)
async def get_organization(
    organization_id: UUID,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> OrganizationRead:
    org = await session.get(Organization, organization_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND")
    seat_count = await count_consumed_seats(session, organization_id)
    storage_gb = await compute_active_storage_gb(get_session_maker(), org.schema_name)
    return await _serialize_org(org, seat_count, storage_gb, storage)


@router.patch("/organizations/{organization_id}", response_model=OrganizationRead)
async def update_organization(
    organization_id: UUID,
    payload: OrganizationUpdate,
    request: Request,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
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
        "active_storage_limit_gb": org.active_storage_limit_gb,
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

    storage_limit_changed = False
    if "active_storage_limit_gb" in fields_set and payload.active_storage_limit_gb != org.active_storage_limit_gb:
        if payload.active_storage_limit_gb is not None:
            await assert_storage_limit_not_below_usage(
                get_session_maker(), org, payload.active_storage_limit_gb,
            )
        updates["active_storage_limit_gb"] = payload.active_storage_limit_gb
        storage_limit_changed = True

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
            "active_storage_limit_gb": refreshed.active_storage_limit_gb,
        }
        if storage_limit_changed:
            await audit.record_for_org(
                session,
                organization_id,
                action="organization.storage_limit_changed",
                resource_type="organization",
                resource_id=organization_id,
                before={"active_storage_limit_gb": before["active_storage_limit_gb"]},
                after={"active_storage_limit_gb": after["active_storage_limit_gb"]},
                actor_user_id=requester.id,
                request=request,
            )
        # If both status and seat_limit changed, prefer the more specific action.
        if seat_limit_changed and "status" not in updates and "name" not in updates:
            action = "organization.seat_limit_changed"
        elif seat_limit_changed:
            # Record an extra audit entry so the seat change is visible
            # even though the primary action describes name/status.
            await audit.record_for_org(
                session,
                organization_id,
                action="organization.seat_limit_changed",
                resource_type="organization",
                resource_id=organization_id,
                before={"seat_limit": before["seat_limit"]},
                after={"seat_limit": after["seat_limit"]},
                actor_user_id=requester.id,
                request=request,
            )
        await audit.record_for_org(
            session,
            organization_id,
            action=action,
            resource_type="organization",
            resource_id=organization_id,
            before=before,
            after=after,
            actor_user_id=requester.id,
            request=request,
        )
        await session.commit()
        org = refreshed

    seat_count = await count_consumed_seats(session, organization_id)
    storage_gb = await compute_active_storage_gb(get_session_maker(), org.schema_name)
    return await _serialize_org(org, seat_count, storage_gb, storage)


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
    response: Response,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    q: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort: SortParams = Depends(sort_params),
) -> list[AdminUserRead]:
    base = select(User)
    if q:
        like = f"%{q.lower()}%"
        base = base.where(
            or_(func.lower(User.email).like(like), func.lower(User.full_name).like(like))
        )

    set_total_count(response, await count_query(session, base))
    stmt = apply_sort(
        base,
        sort,
        {
            "email": User.email,
            "full_name": User.full_name,
            "is_superuser": User.is_superuser,
            "is_verified": User.is_verified,
        },
        default="email",
        default_dir="asc",
        tiebreaker=User.id,
    ).limit(limit).offset(offset)
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
    # Demote must leave at least one active superuser standing.
    if not new_value:
        await assert_last_superuser_invariant(
            session,
            user.id,
            ProposedUserChange(is_superuser=False, is_active=user.is_active),
        )
    user.is_superuser = new_value
    # Platform-level action (no subject org) → platform schema.
    await audit.record_for_org(
        session,
        None,
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
    # Deactivating a superuser cannot empty the surviving-superuser set.
    if not new_value and user.is_superuser:
        await assert_last_superuser_invariant(
            session,
            user.id,
            ProposedUserChange(is_superuser=True, is_active=False),
        )
    user.is_active = new_value
    # Platform-level action (no subject org) → platform schema.
    await audit.record_for_org(
        session,
        None,
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
# Access requests — lead review + approve/reject
# ---------------------------------------------------------------------------


@router.get("/access-requests/export")
async def export_access_requests(
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = None,
) -> "StreamingResponse":
    import csv
    import io

    from starlette.responses import StreamingResponse

    stmt = select(AccessRequest).order_by(AccessRequest.created_at.desc())
    if status_filter:
        stmt = stmt.where(AccessRequest.status == AccessRequestStatus(status_filter))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(AccessRequest.name).like(like),
                func.lower(AccessRequest.work_email).like(like),
                func.lower(AccessRequest.company).like(like),
            )
        )
    result = await session.execute(stmt)
    rows = list(result.scalars())

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "id", "name", "work_email", "company", "role",
        "company_size", "country", "notes", "status",
        "created_at", "updated_at",
    ])
    for r in rows:
        writer.writerow([
            str(r.id), r.name, r.work_email, r.company, r.role,
            r.company_size, r.country, r.notes or "",
            r.status.value, r.created_at.isoformat(),
            r.updated_at.isoformat(),
        ])

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=access-requests.csv"},
    )


@router.get(
    "/access-requests",
    response_model=list[AccessRequestAdminRead],
)
async def list_access_requests(
    response: Response,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort: SortParams = Depends(sort_params),
) -> list[AccessRequestAdminRead]:
    base = select(AccessRequest)
    if status_filter:
        base = base.where(AccessRequest.status == AccessRequestStatus(status_filter))
    if q:
        like = f"%{q.lower()}%"
        base = base.where(
            or_(
                func.lower(AccessRequest.name).like(like),
                func.lower(AccessRequest.work_email).like(like),
                func.lower(AccessRequest.company).like(like),
            )
        )

    set_total_count(response, await count_query(session, base))
    stmt = apply_sort(
        base,
        sort,
        {
            "name": AccessRequest.name,
            "work_email": AccessRequest.work_email,
            "company": AccessRequest.company,
            "status": AccessRequest.status,
            "created_at": AccessRequest.created_at,
        },
        default="created_at",
        default_dir="desc",
        tiebreaker=AccessRequest.id,
    ).limit(limit).offset(offset)
    result = await session.execute(stmt)
    return [
        AccessRequestAdminRead.model_validate(r, from_attributes=True)
        for r in result.scalars()
    ]


@router.post(
    "/access-requests/{request_id}/approve",
    response_model=AccessRequestApproveResponse,
)
async def approve_access_request(
    request_id: UUID,
    request: Request,
    payload: AccessRequestApproveInput | None = None,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
    user_manager: UserManager = Depends(get_user_manager),
    storage: StorageBackend = Depends(get_storage),
) -> AccessRequestApproveResponse:
    ar = await session.get(AccessRequest, request_id)
    if ar is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ACCESS_REQUEST_NOT_FOUND",
        )
    if ar.status != AccessRequestStatus.new:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ACCESS_REQUEST_NOT_PENDING",
        )

    # `payload` is optional so the route still accepts an empty body; fall
    # back to the requester's company name when org_name is omitted.
    org_name = (payload.org_name if payload and payload.org_name else ar.company).strip()
    seat_limit = payload.seat_limit if payload else None
    storage_limit = payload.active_storage_limit_gb if payload else None

    # Pre-check for `Organization.name` uniqueness (case-insensitive). Catching
    # this here gives the admin a clean inline error on the dialog's org_name
    # field; otherwise the provisioning saga would spin up + tear down a schema
    # before raising a generic 500.
    collision = (
        await session.execute(
            select(Organization).where(
                func.lower(Organization.name) == org_name.lower()
            )
        )
    ).scalar_one_or_none()
    if collision is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ORG_NAME_TAKEN",
                "existing_org_id": str(collision.id),
            },
        )

    try:
        result = await provision_organization(
            name=org_name,
            admin_email=ar.work_email,
            admin_full_name=ar.name,
            seat_limit=seat_limit,
            active_storage_limit_gb=storage_limit,
            requester=requester,
            request=request,
        )
    except ProvisioningError as exc:
        # The saga compensates internally, so the DB is back to its pre-call
        # state. Surface a 500 (matches `create_organization` at line 131).
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PROVISIONING_FAILED: {exc}",
        ) from exc

    # Flip the AR to `approved` BEFORE dispatching the activation email. If the
    # AR update happens AFTER email send, any exception in the email path (SMTP
    # blip, transport-layer race, FastAPI Users state) strands the AR at `new`
    # while the saga's org/user/member commits remain — admin retries then hit
    # `ORG_NAME_TAKEN` from the pre-flight check above. Commit here first; the
    # email dispatch below is best-effort and admin can resend on failure.
    ar = await session.get(AccessRequest, request_id)
    assert ar is not None  # we just fetched it above; race would be DB corruption
    ar.status = AccessRequestStatus.approved
    await audit.record_for_org(
        session,
        None,
        action="access_request.approved",
        resource_type="access_request",
        resource_id=ar.id,
        after={
            "work_email": ar.work_email,
            "company": ar.company,
            "organization_id": str(result.organization.id),
            "organization_name": result.organization.name,
        },
        actor_user_id=requester.id,
        request=request,
    )
    await session.commit()
    await session.refresh(ar)

    # Email dispatch happens after the AR commit. Failures are logged but never
    # re-raised — admin can resend via /organizations/{org}/members/{user}/resend-invite.
    await _dispatch_invite_email(
        result=result,
        user_manager=user_manager,
        requester_email=requester.email,
        request=request,
    )

    seat_count = await count_consumed_seats(session, result.organization.id)
    storage_gb = await compute_active_storage_gb(
        get_session_maker(), result.organization.schema_name,
    )
    return AccessRequestApproveResponse(
        access_request=AccessRequestAdminRead.model_validate(ar, from_attributes=True),
        organization=await _serialize_org(
            result.organization, seat_count, storage_gb, storage,
        ),
        admin_email=result.admin.email,
        activation_required=result.activation_required,
    )


@router.post(
    "/access-requests/{request_id}/reject",
    response_model=AccessRequestAdminRead,
)
async def reject_access_request(
    request_id: UUID,
    request: Request,
    requester: User = Depends(require_superuser),
    session: AsyncSession = Depends(get_async_session),
) -> AccessRequestAdminRead:
    ar = await session.get(AccessRequest, request_id)
    if ar is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ACCESS_REQUEST_NOT_FOUND",
        )
    if ar.status != AccessRequestStatus.new:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ACCESS_REQUEST_NOT_PENDING",
        )

    ar.status = AccessRequestStatus.rejected
    await audit.record_for_org(
        session,
        None,
        action="access_request.rejected",
        resource_type="access_request",
        resource_id=ar.id,
        after={"work_email": ar.work_email, "company": ar.company},
        actor_user_id=requester.id,
        request=request,
    )
    await session.commit()
    await session.refresh(ar)
    return AccessRequestAdminRead.model_validate(ar, from_attributes=True)


# ---------------------------------------------------------------------------
# Audit log — super-admin global view
# ---------------------------------------------------------------------------


@router.get("/audit-log", response_model=list[AuditEntry])
async def list_audit_log(
    response: Response,
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
    sort: SortParams = Depends(sort_params),
) -> list[AuditEntry]:
    # audit_log is a per-tenant table. With ?organization_id, read that org's
    # schema; without it, read the platform schema (super-admin / org-less
    # events). No cross-org UNION — drill into one org at a time.
    if organization_id is not None:
        schema = schema_name_for(organization_id)
    else:
        schema = await resolve_platform_schema(session)
    await session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))

    base = select(AuditLog)
    if action:
        base = base.where(AuditLog.action == action)
    if resource_type:
        base = base.where(AuditLog.resource_type == resource_type)
    if resource_id:
        base = base.where(AuditLog.resource_id == resource_id)
    if user_id:
        base = base.where(AuditLog.user_id == user_id)
    if since:
        base = base.where(AuditLog.created_at >= since)
    if until:
        base = base.where(AuditLog.created_at < until)

    # Count + read must run while search_path still points at the org schema.
    set_total_count(response, await count_query(session, base))
    stmt = apply_sort(
        base,
        sort,
        {
            "created_at": AuditLog.created_at,
            "action": AuditLog.action,
            "resource_type": AuditLog.resource_type,
        },
        default="created_at",
        default_dir="desc",
        tiebreaker=AuditLog.id,
    ).limit(limit).offset(offset)
    result = await session.execute(stmt)
    entries = [AuditEntry.model_validate(e, from_attributes=True) for e in result.scalars()]
    await session.execute(text("SET LOCAL search_path TO public"))
    return entries
