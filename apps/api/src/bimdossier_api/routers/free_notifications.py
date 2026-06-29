"""Free-tier notification feed — `public.free_notifications` (per recipient).

A near-verbatim copy of `routers/notifications.py` for the pooled free tier:

  * scoped by the authenticated free user (RLS keys on `recipient_user_id`), not an
    org — so there's no `require_active_organization` and no `active_org_id`;
  * free rows are always targeted (one per recipient), so there's no
    `recipient IS NULL` org-wide branch — the filter is a plain
    `recipient_user_id = me` (belt-and-suspenders over RLS);
  * reuses the SAME paid response schemas so the portal bell is unchanged —
    `organization_id` is the free sentinel, `project_id`/`file_id` carry the free
    ids, `job_id` is null (free has no public job).

Flag-gated like the rest of `/free/*`.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from redis.asyncio import Redis
from sqlalchemy import ColumnElement, and_, case, exists, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.cache import get_redis_dep
from bimdossier_api.jobs.priority import FREE_TIER_SENTINEL_ORG
from bimdossier_api.models.free_notification import (
    FreeNotification,
    FreeNotificationUserState,
)
from bimdossier_api.models.user import User
from bimdossier_api.pagination import encode_cursor, keyset_after
from bimdossier_api.routers.free_access import require_free_tier_enabled
from bimdossier_api.schemas.notification import (
    NotificationListResponse,
    NotificationOut,
    UnreadCountResponse,
)
from bimdossier_api.tenancy import get_free_session

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/free/notifications",
    tags=["free-notifications"],
    dependencies=[Depends(require_free_tier_enabled)],
)

_UNREAD_COUNT_TTL_SECONDS = 20


def _unread_count_key(user_id: UUID) -> str:
    return f"notif:free:unread:{user_id}"


async def _invalidate_unread_count(redis: Redis, user_id: UUID) -> None:
    key = _unread_count_key(user_id)
    try:
        await redis.delete(key)
    except Exception:
        logger.warning("free unread-count cache invalidation failed for %s", key, exc_info=True)


def _to_out(notif: FreeNotification, *, is_read: bool) -> NotificationOut:
    """Map a free row onto the shared paid `NotificationOut` shape (so the portal's
    Zod schema + bell are unchanged): sentinel org, free ids as project/file, no job."""
    return NotificationOut(
        id=notif.id,
        organization_id=FREE_TIER_SENTINEL_ORG,
        project_id=notif.free_project_id,
        file_id=notif.free_file_id,
        job_id=None,
        event_type=notif.event_type,  # StrEnum coerces "job_succeeded"/"job_failed"
        title=notif.title,
        body=notif.body,
        is_read=is_read,
        created_at=notif.created_at,
    )


def _is_read_expr(user_id: UUID) -> ColumnElement[bool]:
    return exists(
        select(FreeNotificationUserState.notification_id).where(
            FreeNotificationUserState.notification_id == FreeNotification.id,
            FreeNotificationUserState.user_id == user_id,
            FreeNotificationUserState.read_at.is_not(None),
        )
    )


def _dismissed_expr(user_id: UUID) -> ColumnElement[bool]:
    return exists(
        select(FreeNotificationUserState.notification_id).where(
            FreeNotificationUserState.notification_id == FreeNotification.id,
            FreeNotificationUserState.user_id == user_id,
            FreeNotificationUserState.dismissed_at.is_not(None),
        )
    )


@router.get("", response_model=NotificationListResponse)
async def list_free_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    cursor: str | None = Query(default=None),
    session: AsyncSession = Depends(get_free_session),
    user: User = Depends(current_verified_user),
) -> NotificationListResponse:
    state = FreeNotificationUserState
    join_cond = and_(
        state.notification_id == FreeNotification.id,
        state.user_id == user.id,
    )
    base_filters = (
        FreeNotification.recipient_user_id == user.id,
        state.dismissed_at.is_(None),
    )

    counts_row = (
        await session.execute(
            select(
                func.count().label("total"),
                func.sum(case((state.read_at.is_(None), 1), else_=0)).label("unread"),
            )
            .select_from(FreeNotification)
            .outerjoin(state, join_cond)
            .where(*base_filters)
        )
    ).one()
    total = int(counts_row.total or 0)
    unread_count = int(counts_row.unread or 0)

    is_read_col = case((state.read_at.is_not(None), True), else_=False).label("is_read")
    page_stmt = (
        select(FreeNotification, is_read_col)
        .outerjoin(state, join_cond)
        .where(*base_filters)
        .order_by(FreeNotification.created_at.desc(), FreeNotification.id.desc())
        .limit(limit)
    )
    if cursor is not None:
        page_stmt = page_stmt.where(
            keyset_after(FreeNotification.created_at, FreeNotification.id, cursor)
        )
    else:
        page_stmt = page_stmt.offset(offset)

    rows = (await session.execute(page_stmt)).all()
    items = [_to_out(row.FreeNotification, is_read=row.is_read) for row in rows]
    next_cursor: str | None = None
    if len(rows) == limit and rows:
        last = rows[-1].FreeNotification
        next_cursor = encode_cursor(last.created_at, last.id)

    return NotificationListResponse(
        items=items,
        total=total,
        unread_count=unread_count,
        limit=limit,
        offset=offset,
        next_cursor=next_cursor,
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
async def free_unread_count(
    session: AsyncSession = Depends(get_free_session),
    user: User = Depends(current_verified_user),
    redis: Redis = Depends(get_redis_dep),
) -> UnreadCountResponse:
    key = _unread_count_key(user.id)
    try:
        cached = await redis.get(key)
        if cached is not None:
            return UnreadCountResponse(count=int(cached))
    except Exception:
        logger.warning("free unread-count cache read failed for %s", key, exc_info=True)

    stmt = (
        select(func.count())
        .select_from(FreeNotification)
        .where(
            FreeNotification.recipient_user_id == user.id,
            ~_is_read_expr(user.id),
            ~_dismissed_expr(user.id),
        )
    )
    count = (await session.scalar(stmt)) or 0

    try:
        await redis.set(key, count, ex=_UNREAD_COUNT_TTL_SECONDS)
    except Exception:
        logger.warning("free unread-count cache write failed for %s", key, exc_info=True)

    return UnreadCountResponse(count=count)


async def _load_or_404(session: AsyncSession, notification_id: UUID, user_id: UUID) -> None:
    notif = (
        await session.execute(
            select(FreeNotification.id).where(
                FreeNotification.id == notification_id,
                FreeNotification.recipient_user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if notif is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="NOTIFICATION_NOT_FOUND")


@router.patch("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_free_read(
    notification_id: UUID,
    session: AsyncSession = Depends(get_free_session),
    user: User = Depends(current_verified_user),
    redis: Redis = Depends(get_redis_dep),
) -> None:
    await _load_or_404(session, notification_id, user.id)
    stmt = (
        pg_insert(FreeNotificationUserState)
        .values(notification_id=notification_id, user_id=user.id, read_at=func.now())
        .on_conflict_do_update(
            index_elements=["notification_id", "user_id"],
            set_={"read_at": func.now()},
            where=FreeNotificationUserState.read_at.is_(None),
        )
    )
    await session.execute(stmt)
    await session.flush()
    await _invalidate_unread_count(redis, user.id)


@router.post("/{notification_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_free(
    notification_id: UUID,
    session: AsyncSession = Depends(get_free_session),
    user: User = Depends(current_verified_user),
    redis: Redis = Depends(get_redis_dep),
) -> None:
    await _load_or_404(session, notification_id, user.id)
    stmt = (
        pg_insert(FreeNotificationUserState)
        .values(notification_id=notification_id, user_id=user.id, dismissed_at=func.now())
        .on_conflict_do_update(
            index_elements=["notification_id", "user_id"],
            set_={"dismissed_at": func.now()},
            where=FreeNotificationUserState.dismissed_at.is_(None),
        )
    )
    await session.execute(stmt)
    await session.flush()
    await _invalidate_unread_count(redis, user.id)


@router.post("/mark-all-read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_free_read(
    session: AsyncSession = Depends(get_free_session),
    user: User = Depends(current_verified_user),
    redis: Redis = Depends(get_redis_dep),
) -> None:
    unread_ids = list(
        (
            await session.execute(
                select(FreeNotification.id).where(
                    FreeNotification.recipient_user_id == user.id,
                    ~_is_read_expr(user.id),
                    ~_dismissed_expr(user.id),
                )
            )
        )
        .scalars()
        .all()
    )
    if unread_ids:
        stmt = (
            pg_insert(FreeNotificationUserState)
            .values(
                [
                    {"notification_id": nid, "user_id": user.id, "read_at": func.now()}
                    for nid in unread_ids
                ]
            )
            .on_conflict_do_update(
                index_elements=["notification_id", "user_id"],
                set_={"read_at": func.now()},
                where=FreeNotificationUserState.read_at.is_(None),
            )
        )
        await session.execute(stmt)
        await session.flush()
        await _invalidate_unread_count(redis, user.id)


@router.post("/clear", status_code=status.HTTP_204_NO_CONTENT)
async def clear_free(
    session: AsyncSession = Depends(get_free_session),
    user: User = Depends(current_verified_user),
    redis: Redis = Depends(get_redis_dep),
) -> None:
    visible_ids = list(
        (
            await session.execute(
                select(FreeNotification.id).where(
                    FreeNotification.recipient_user_id == user.id,
                    ~_dismissed_expr(user.id),
                )
            )
        )
        .scalars()
        .all()
    )
    if visible_ids:
        stmt = (
            pg_insert(FreeNotificationUserState)
            .values(
                [
                    {"notification_id": nid, "user_id": user.id, "dismissed_at": func.now()}
                    for nid in visible_ids
                ]
            )
            .on_conflict_do_update(
                index_elements=["notification_id", "user_id"],
                set_={"dismissed_at": func.now()},
                where=FreeNotificationUserState.dismissed_at.is_(None),
            )
        )
        await session.execute(stmt)
        await session.flush()
        await _invalidate_unread_count(redis, user.id)


__all__ = ["router"]
