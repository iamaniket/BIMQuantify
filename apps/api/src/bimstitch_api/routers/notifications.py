from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.models.notification import Notification, NotificationRead
from bimstitch_api.models.user import User
from bimstitch_api.schemas.notification import (
    NotificationListResponse,
    NotificationOut,
    UnreadCountResponse,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> NotificationListResponse:
    is_read_expr = exists(
        select(NotificationRead.notification_id).where(
            NotificationRead.notification_id == Notification.id,
            NotificationRead.user_id == user.id,
        )
    )

    count_stmt = select(func.count()).select_from(Notification)
    total = (await session.scalar(count_stmt)) or 0

    unread_stmt = select(func.count()).select_from(Notification).where(~is_read_expr)
    unread_count = (await session.scalar(unread_stmt)) or 0

    stmt = (
        select(
            Notification,
            case((is_read_expr, True), else_=False).label("is_read"),
        )
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    rows = (await session.execute(stmt)).all()
    items = [
        NotificationOut(
            id=row.Notification.id,
            organization_id=active_org_id,
            project_id=row.Notification.project_id,
            file_id=row.Notification.file_id,
            job_id=row.Notification.job_id,
            event_type=row.Notification.event_type,
            title=row.Notification.title,
            body=row.Notification.body,
            is_read=row.is_read,
            created_at=row.Notification.created_at,
        )
        for row in rows
    ]

    return NotificationListResponse(
        items=items,
        total=total,
        unread_count=unread_count,
        limit=limit,
        offset=offset,
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
async def unread_count(
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> UnreadCountResponse:
    is_read_expr = exists(
        select(NotificationRead.notification_id).where(
            NotificationRead.notification_id == Notification.id,
            NotificationRead.user_id == user.id,
        )
    )
    stmt = select(func.count()).select_from(Notification).where(~is_read_expr)
    count = (await session.scalar(stmt)) or 0
    return UnreadCountResponse(count=count)


@router.patch("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    notification_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> None:
    notif = (
        await session.execute(select(Notification).where(Notification.id == notification_id))
    ).scalar_one_or_none()
    if notif is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NOTIFICATION_NOT_FOUND",
        )

    existing = (
        await session.execute(
            select(NotificationRead).where(
                NotificationRead.notification_id == notification_id,
                NotificationRead.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        session.add(NotificationRead(notification_id=notification_id, user_id=user.id))
        await session.flush()


@router.post("/mark-all-read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> None:
    is_read_expr = exists(
        select(NotificationRead.notification_id).where(
            NotificationRead.notification_id == Notification.id,
            NotificationRead.user_id == user.id,
        )
    )
    unread_stmt = select(Notification.id).where(~is_read_expr)
    unread_ids = list((await session.execute(unread_stmt)).scalars().all())
    for nid in unread_ids:
        session.add(NotificationRead(notification_id=nid, user_id=user.id))
    if unread_ids:
        await session.flush()


__all__ = ["router"]
