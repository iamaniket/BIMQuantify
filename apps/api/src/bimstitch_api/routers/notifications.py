import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from redis.asyncio import Redis
from sqlalchemy import case, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.cache import get_redis_dep
from bimstitch_api.models.notification import (
    Notification,
    NotificationDismissal,
    NotificationRead,
)
from bimstitch_api.models.user import User
from bimstitch_api.schemas.notification import (
    NotificationListResponse,
    NotificationOut,
    UnreadCountResponse,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])

# The unread badge is polled on dashboard load; at ~1M notifications/org the
# full COUNT is a seq scan, so cache it briefly per (org, user). Live updates
# already arrive over the WS pub/sub channel, so a short TTL bounds the only
# staleness window (a broadcast create the writer didn't invalidate).
_UNREAD_COUNT_TTL_SECONDS = 20


def _unread_count_key(org_id: UUID, user_id: UUID) -> str:
    return f"notif:unread:{org_id}:{user_id}"


async def _invalidate_unread_count(redis: Redis, org_id: UUID, user_id: UUID) -> None:
    key = _unread_count_key(org_id, user_id)
    try:
        await redis.delete(key)
    except Exception:
        logger.warning("unread-count cache invalidation failed for %s", key, exc_info=True)


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
    # Dismissed rows are hidden from this user's feed and counts (per-user,
    # like read state) — never hard-deleted from the org-shared table.
    dismissed_expr = exists(
        select(NotificationDismissal.notification_id).where(
            NotificationDismissal.notification_id == Notification.id,
            NotificationDismissal.user_id == user.id,
        )
    )

    count_stmt = select(func.count()).select_from(Notification).where(~dismissed_expr)
    total = (await session.scalar(count_stmt)) or 0

    unread_stmt = (
        select(func.count())
        .select_from(Notification)
        .where(~is_read_expr, ~dismissed_expr)
    )
    unread_count = (await session.scalar(unread_stmt)) or 0

    stmt = (
        select(
            Notification,
            case((is_read_expr, True), else_=False).label("is_read"),
        )
        .where(~dismissed_expr)
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
    active_org_id: UUID = Depends(require_active_organization),
    redis: Redis = Depends(get_redis_dep),
) -> UnreadCountResponse:
    key = _unread_count_key(active_org_id, user.id)
    try:
        cached = await redis.get(key)
        if cached is not None:
            return UnreadCountResponse(count=int(cached))
    except Exception:
        logger.warning("unread-count cache read failed for %s", key, exc_info=True)

    is_read_expr = exists(
        select(NotificationRead.notification_id).where(
            NotificationRead.notification_id == Notification.id,
            NotificationRead.user_id == user.id,
        )
    )
    dismissed_expr = exists(
        select(NotificationDismissal.notification_id).where(
            NotificationDismissal.notification_id == Notification.id,
            NotificationDismissal.user_id == user.id,
        )
    )
    stmt = (
        select(func.count())
        .select_from(Notification)
        .where(~is_read_expr, ~dismissed_expr)
    )
    count = (await session.scalar(stmt)) or 0

    try:
        await redis.set(key, count, ex=_UNREAD_COUNT_TTL_SECONDS)
    except Exception:
        logger.warning("unread-count cache write failed for %s", key, exc_info=True)

    return UnreadCountResponse(count=count)


@router.patch("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    notification_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    redis: Redis = Depends(get_redis_dep),
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
        await _invalidate_unread_count(redis, active_org_id, user.id)


@router.post("/{notification_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss(
    notification_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    redis: Redis = Depends(get_redis_dep),
) -> None:
    """Dismiss a notification for the current user only.

    Inserts a per-user ``NotificationDismissal`` row (idempotent) so the
    notification disappears from this user's feed and counts. The org-shared
    notification row is untouched — teammates still see it.
    """
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
            select(NotificationDismissal).where(
                NotificationDismissal.notification_id == notification_id,
                NotificationDismissal.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        session.add(NotificationDismissal(notification_id=notification_id, user_id=user.id))
        await session.flush()
        await _invalidate_unread_count(redis, active_org_id, user.id)


@router.post("/mark-all-read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    redis: Redis = Depends(get_redis_dep),
) -> None:
    is_read_expr = exists(
        select(NotificationRead.notification_id).where(
            NotificationRead.notification_id == Notification.id,
            NotificationRead.user_id == user.id,
        )
    )
    dismissed_expr = exists(
        select(NotificationDismissal.notification_id).where(
            NotificationDismissal.notification_id == Notification.id,
            NotificationDismissal.user_id == user.id,
        )
    )
    unread_stmt = select(Notification.id).where(~is_read_expr, ~dismissed_expr)
    unread_ids = list((await session.execute(unread_stmt)).scalars().all())
    for nid in unread_ids:
        session.add(NotificationRead(notification_id=nid, user_id=user.id))
    if unread_ids:
        await session.flush()
        await _invalidate_unread_count(redis, active_org_id, user.id)


@router.post("/clear", status_code=status.HTTP_204_NO_CONTENT)
async def clear(
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    redis: Redis = Depends(get_redis_dep),
) -> None:
    """Clear (dismiss) the current user's entire feed.

    Bulk-inserts a ``NotificationDismissal`` for every notification the user
    has not already dismissed — read and unread alike — emptying their feed
    without affecting teammates.
    """
    dismissed_expr = exists(
        select(NotificationDismissal.notification_id).where(
            NotificationDismissal.notification_id == Notification.id,
            NotificationDismissal.user_id == user.id,
        )
    )
    visible_ids = list(
        (await session.execute(select(Notification.id).where(~dismissed_expr))).scalars().all()
    )
    for nid in visible_ids:
        session.add(NotificationDismissal(notification_id=nid, user_id=user.id))
    if visible_ids:
        await session.flush()
        await _invalidate_unread_count(redis, active_org_id, user.id)


__all__ = ["router"]
