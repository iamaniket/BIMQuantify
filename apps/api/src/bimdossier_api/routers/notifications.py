import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from redis.asyncio import Redis
from sqlalchemy import ColumnElement, and_, case, exists, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.cache import get_redis_dep
from bimdossier_api.models.notification import (
    Notification,
    NotificationUserState,
)
from bimdossier_api.models.user import User
from bimdossier_api.pagination import encode_cursor, keyset_after
from bimdossier_api.schemas.notification import (
    NotificationListResponse,
    NotificationOut,
    UnreadCountResponse,
)
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

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


# Per-user read/dismiss state lives on a single `notification_user_state` row
# (read_at / dismissed_at independently nullable). "Read" and "dismissed" are
# therefore row-membership checks gated on the relevant timestamp being set.
def _is_read_expr(user_id: UUID) -> ColumnElement[bool]:
    return exists(
        select(NotificationUserState.notification_id).where(
            NotificationUserState.notification_id == Notification.id,
            NotificationUserState.user_id == user_id,
            NotificationUserState.read_at.is_not(None),
        )
    )


def _dismissed_expr(user_id: UUID) -> ColumnElement[bool]:
    return exists(
        select(NotificationUserState.notification_id).where(
            NotificationUserState.notification_id == Notification.id,
            NotificationUserState.user_id == user_id,
            NotificationUserState.dismissed_at.is_not(None),
        )
    )


# Per-recipient targeting: a row is visible to this user when it is org-wide
# (`recipient_user_id IS NULL`, the original behaviour for every existing row)
# or addressed to them. ANDed into every read so a targeted @mention ping never
# surfaces in another member's feed or counts.
def _recipient_visible_expr(user_id: UUID) -> ColumnElement[bool]:
    return (Notification.recipient_user_id.is_(None)) | (
        Notification.recipient_user_id == user_id
    )


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    cursor: str | None = Query(
        default=None,
        description="Keyset cursor from a prior response's next_cursor. When set, "
        "pages by (created_at, id) and ignores offset — for 'load more' feeds.",
    ),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> NotificationListResponse:
    visible_expr = _recipient_visible_expr(user.id)

    # The per-user state row (read/dismiss) is LEFT-JOINed once — the composite
    # PK (notification_id, user_id) means at most one match, so no fan-out —
    # instead of three correlated EXISTS sweeps. Dismissed rows are hidden from
    # this user's feed and counts (per-user, like read state), never hard-deleted
    # from the org-shared table; with the outer join, `dismissed_at IS NULL`
    # covers both "no state row" and "not dismissed".
    state = NotificationUserState
    join_cond = and_(
        state.notification_id == Notification.id,
        state.user_id == user.id,
    )
    base_filters = (state.dismissed_at.is_(None), visible_expr)

    # Counts over the FULL filtered set in one aggregate query (not per-page) —
    # so they stay exact whether the page is fetched by offset or keyset cursor.
    counts_row = (
        await session.execute(
            select(
                func.count().label("total"),
                func.sum(case((state.read_at.is_(None), 1), else_=0)).label("unread"),
            )
            .select_from(Notification)
            .outerjoin(state, join_cond)
            .where(*base_filters)
        )
    ).one()
    total = int(counts_row.total or 0)
    unread_count = int(counts_row.unread or 0)

    # Page query. Keyset (cursor) skips the OFFSET scan so deep "load more" pages
    # cost the same as the first; offset stays the default for compatibility.
    is_read_col = case((state.read_at.is_not(None), True), else_=False).label("is_read")
    page_stmt = (
        select(Notification, is_read_col)
        .outerjoin(state, join_cond)
        .where(*base_filters)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    )
    if cursor is not None:
        page_stmt = page_stmt.where(
            keyset_after(Notification.created_at, Notification.id, cursor)
        )
    else:
        page_stmt = page_stmt.offset(offset)

    rows = (await session.execute(page_stmt)).all()
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
    # A full page implies there may be more — hand back a cursor at the last row.
    next_cursor: str | None = None
    if len(rows) == limit and rows:
        last = rows[-1].Notification
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

    stmt = (
        select(func.count())
        .select_from(Notification)
        .where(
            ~_is_read_expr(user.id),
            ~_dismissed_expr(user.id),
            _recipient_visible_expr(user.id),
        )
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
        await session.execute(
            select(Notification).where(
                Notification.id == notification_id,
                _recipient_visible_expr(user.id),
            )
        )
    ).scalar_one_or_none()
    if notif is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NOTIFICATION_NOT_FOUND",
        )

    # Upsert the per-user state row, stamping read_at only on first read
    # (idempotent — a repeat call keeps the original timestamp).
    stmt = (
        pg_insert(NotificationUserState)
        .values(notification_id=notification_id, user_id=user.id, read_at=func.now())
        .on_conflict_do_update(
            index_elements=["notification_id", "user_id"],
            set_={"read_at": func.now()},
            where=NotificationUserState.read_at.is_(None),
        )
    )
    await session.execute(stmt)
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

    Upserts the per-user state row's ``dismissed_at`` (idempotent) so the
    notification disappears from this user's feed and counts. The org-shared
    notification row is untouched — teammates still see it.
    """
    notif = (
        await session.execute(
            select(Notification).where(
                Notification.id == notification_id,
                _recipient_visible_expr(user.id),
            )
        )
    ).scalar_one_or_none()
    if notif is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NOTIFICATION_NOT_FOUND",
        )

    stmt = (
        pg_insert(NotificationUserState)
        .values(notification_id=notification_id, user_id=user.id, dismissed_at=func.now())
        .on_conflict_do_update(
            index_elements=["notification_id", "user_id"],
            set_={"dismissed_at": func.now()},
            where=NotificationUserState.dismissed_at.is_(None),
        )
    )
    await session.execute(stmt)
    await session.flush()
    await _invalidate_unread_count(redis, active_org_id, user.id)


@router.post("/mark-all-read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    redis: Redis = Depends(get_redis_dep),
) -> None:
    unread_stmt = select(Notification.id).where(
        ~_is_read_expr(user.id),
        ~_dismissed_expr(user.id),
        _recipient_visible_expr(user.id),
    )
    unread_ids = list((await session.execute(unread_stmt)).scalars().all())
    if unread_ids:
        stmt = (
            pg_insert(NotificationUserState)
            .values(
                [
                    {"notification_id": nid, "user_id": user.id, "read_at": func.now()}
                    for nid in unread_ids
                ]
            )
            .on_conflict_do_update(
                index_elements=["notification_id", "user_id"],
                set_={"read_at": func.now()},
                where=NotificationUserState.read_at.is_(None),
            )
        )
        await session.execute(stmt)
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

    Bulk-upserts ``dismissed_at`` for every notification the user has not
    already dismissed — read and unread alike — emptying their feed without
    affecting teammates.
    """
    visible_ids = list(
        (
            await session.execute(
                select(Notification.id).where(
                    ~_dismissed_expr(user.id),
                    _recipient_visible_expr(user.id),
                )
            )
        )
        .scalars()
        .all()
    )
    if visible_ids:
        stmt = (
            pg_insert(NotificationUserState)
            .values(
                [
                    {"notification_id": nid, "user_id": user.id, "dismissed_at": func.now()}
                    for nid in visible_ids
                ]
            )
            .on_conflict_do_update(
                index_elements=["notification_id", "user_id"],
                set_={"dismissed_at": func.now()},
                where=NotificationUserState.dismissed_at.is_(None),
            )
        )
        await session.execute(stmt)
        await session.flush()
        await _invalidate_unread_count(redis, active_org_id, user.id)


__all__ = ["router"]
