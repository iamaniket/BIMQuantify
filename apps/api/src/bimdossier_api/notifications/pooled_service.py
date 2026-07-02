"""Emission + Redis publish for free-tier notifications (pooled, per-recipient).

Mirrors `notifications/service.py` on the free side. The free extraction callback
(`routers/pooled_documents.py::pooled_extraction_callback`) calls
`emit_pooled_job_notification` POST-commit so a slow Redis/notification step never
extends the row lock or fails the worker callback.

Localized PER RECIPIENT (each is a known `User`), unlike paid job notifications
(which localize off the project country since there's no single recipient). Reuses
the paid `notifications.extraction.*` catalog keys — identical copy, no new keys.
"""

import json
import logging
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.cache import get_redis
from bimdossier_api.i18n import t
from bimdossier_api.i18n.resolution import resolve_user_locale
from bimdossier_api.jobs.priority import FREE_TIER_SENTINEL_ORG
from bimdossier_api.models.pooled_notification import (
    PooledNotification,
    PooledNotificationUserState,
)
from bimdossier_api.models.user import User

logger = logging.getLogger(__name__)

# Per-user Redis channel — the ConnectionManager fans a free push to this user's
# sockets only. Kept distinct from the paid `notifications:org:` prefix.
CHANNEL_PREFIX_POOLED = "notifications:pooled:user:"

# Free terminal-extraction event → the `notifications.extraction.<stem>` catalog
# stem (reused from the paid path; values match NotificationEventType).
_POOLED_EVENT_STEM: dict[str, str] = {
    "job_succeeded": "completed",
    "job_failed": "failed",
}


async def _upsert_pooled_notification(
    session: AsyncSession,
    *,
    recipient_user_id: UUID,
    event_type: str,
    title: str,
    body: str,
    pooled_project_id: UUID | None,
    pooled_document_id: UUID | None,
    pooled_file_id: UUID | None,
) -> PooledNotification:
    """Create or resurface a free notification for (recipient, file).

    On retry-extraction the existing row is updated in place and its read/dismiss
    state cleared so it resurfaces as unread (mirrors paid `upsert_job_notification`).
    """
    existing: PooledNotification | None = None
    if pooled_file_id is not None:
        existing = (
            await session.execute(
                select(PooledNotification)
                .where(
                    PooledNotification.recipient_user_id == recipient_user_id,
                    PooledNotification.pooled_file_id == pooled_file_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()

    if existing is not None:
        existing.event_type = event_type
        existing.title = title
        existing.body = body
        existing.pooled_project_id = pooled_project_id
        existing.pooled_document_id = pooled_document_id
        existing.created_at = func.now()
        await session.execute(
            delete(PooledNotificationUserState).where(
                PooledNotificationUserState.notification_id == existing.id
            )
        )
        await session.flush()
        await session.refresh(existing)
        return existing

    notification = PooledNotification(
        recipient_user_id=recipient_user_id,
        event_type=event_type,
        title=title,
        body=body,
        pooled_project_id=pooled_project_id,
        pooled_document_id=pooled_document_id,
        pooled_file_id=pooled_file_id,
    )
    session.add(notification)
    await session.flush()
    return notification


async def publish_pooled_notification(notification: PooledNotification) -> None:
    """Publish a free notification on its recipient's Redis channel.

    The JSON shape matches the paid notification payload (so the portal's shared
    WS handler is unchanged): `organization_id` is the sentinel, `project_id` /
    `file_id` carry the free ids, and `job_id` is null (free has no public job).
    `created_at` is read off `__dict__` to avoid a lazy refresh (MissingGreenlet).
    """
    created_at = notification.__dict__.get("created_at")
    payload = json.dumps(
        {
            "id": str(notification.id),
            "organization_id": str(FREE_TIER_SENTINEL_ORG),
            "recipient_user_id": str(notification.recipient_user_id),
            "project_id": (
                str(notification.pooled_project_id) if notification.pooled_project_id else None
            ),
            "file_id": (str(notification.pooled_file_id) if notification.pooled_file_id else None),
            "job_id": None,
            "event_type": notification.event_type,
            "title": notification.title,
            "body": notification.body,
            "created_at": created_at.isoformat() if created_at else None,
        }
    )
    channel = f"{CHANNEL_PREFIX_POOLED}{notification.recipient_user_id}"
    try:
        redis = get_redis()
        await redis.publish(channel, payload)
    except Exception:
        logger.exception("Failed to publish free notification to %s", channel)


async def emit_pooled_report_notification(
    *,
    recipient_user_id: UUID,
    event_type: str,
    report_title: str,
    locale: str,
    project_id: UUID | None,
    error: str | None = None,
) -> None:
    """Create + publish a free report (snag-list PDF) notification to the
    REQUESTER only — a report is requester-centric, unlike a shared model
    extraction. Best-effort (logged, never masking the worker callback); own
    superuser session, post-commit publish. Reuses the paid `notifications.job.*`
    catalog keys. ``pooled_file_id=None`` skips the per-file dedupe upsert."""
    from bimdossier_api.db import get_session_maker
    from bimdossier_api.i18n import coerce_locale

    stem = "ready" if event_type == "job_succeeded" else "failed"
    loc = coerce_locale(locale)
    title = t(f"notifications.job.{stem}.title", loc)
    if event_type == "job_failed":
        body = t(
            f"notifications.job.{stem}.body",
            loc,
            report_title=report_title,
            error=(error or "")[:200],
        )
    else:
        body = t(f"notifications.job.{stem}.body", loc, report_title=report_title)
    try:
        sm = get_session_maker()
        async with sm() as session, session.begin():
            notification = await _upsert_pooled_notification(
                session,
                recipient_user_id=recipient_user_id,
                event_type=event_type,
                title=title,
                body=body,
                pooled_project_id=project_id,
                pooled_document_id=None,
                pooled_file_id=None,
            )
        await publish_pooled_notification(notification)
    except Exception:
        logger.warning(
            "Failed to emit free %s report notification for %s",
            event_type,
            recipient_user_id,
            exc_info=True,
        )


async def emit_pooled_job_notification(
    *,
    recipients: list[UUID],
    event_type: str,
    file_id: UUID,
    document_id: UUID,
    project_id: UUID | None,
    filename: str,
    error: str | None = None,
) -> None:
    """Create + publish a free extraction notification to each recipient (the
    model's owner + invited members).

    Best-effort: any failure is logged, never masking the worker callback. Runs in
    its OWN superuser session (RLS-bypassing, post the callback's commit) so it can
    fan out to other users and doesn't extend the callback's row lock.
    """
    from bimdossier_api.db import get_session_maker

    stem = _POOLED_EVENT_STEM.get(event_type)
    if stem is None or not recipients:
        return
    try:
        sm = get_session_maker()
        created: list[PooledNotification] = []
        async with sm() as session, session.begin():
            # ≤4 recipients (owner + up to 3 members) — a per-id load is cheap and
            # avoids a typed-column .in_() over the User PK.
            for uid in recipients:
                user = await session.get(User, uid)
                if user is None:
                    continue
                locale = resolve_user_locale(user)
                title = t(f"notifications.extraction.{stem}.title", locale)
                if event_type == "job_failed":
                    err = (error or t("notifications.extraction.unknown_error", locale))[:200]
                    body = t(
                        "notifications.extraction.failed.body",
                        locale,
                        filename=filename,
                        error=err,
                    )
                else:
                    body = t(f"notifications.extraction.{stem}.body", locale, filename=filename)
                created.append(
                    await _upsert_pooled_notification(
                        session,
                        recipient_user_id=user.id,
                        event_type=event_type,
                        title=title,
                        body=body,
                        pooled_project_id=project_id,
                        pooled_document_id=document_id,
                        pooled_file_id=file_id,
                    )
                )
        # Publish AFTER commit so the rows are visible to readers.
        for notification in created:
            await publish_pooled_notification(notification)
    except Exception:
        logger.warning(
            "Failed to emit free %s notification for file %s",
            event_type,
            file_id,
            exc_info=True,
        )
