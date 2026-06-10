import json
import logging
from uuid import UUID

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.cache import get_redis
from bimstitch_api.models.notification import (
    Notification,
    NotificationDismissal,
    NotificationEventType,
    NotificationRead,
)

logger = logging.getLogger(__name__)

CHANNEL_PREFIX = "notifications:org:"


async def create_notification(
    session: AsyncSession,
    *,
    event_type: NotificationEventType,
    title: str,
    body: str,
    project_id: UUID | None = None,
    file_id: UUID | None = None,
    job_id: UUID | None = None,
) -> Notification:
    """Insert a notification row in the active tenant schema.

    The session must already have `search_path` set to the target org's
    schema (either by `get_tenant_session` or by the internal callback
    handler). The notification lives in `org_<hex>.notifications` — there
    is no `organization_id` column because the schema name IS the org.
    """
    notification = Notification(
        event_type=event_type,
        title=title,
        body=body,
        project_id=project_id,
        file_id=file_id,
        job_id=job_id,
    )
    session.add(notification)
    await session.flush()
    return notification


async def upsert_job_notification(
    session: AsyncSession,
    *,
    event_type: NotificationEventType,
    title: str,
    body: str,
    project_id: UUID | None = None,
    file_id: UUID | None = None,
    job_id: UUID,
) -> Notification:
    """Create or update a notification for a given job.

    When a notification for ``job_id`` already exists, update it in-place
    and clear all per-user read/dismissal state so it resurfaces as unread.
    """
    stmt = (
        select(Notification)
        .where(Notification.job_id == job_id)
        .with_for_update()
    )
    existing = (await session.execute(stmt)).scalar_one_or_none()

    if existing is not None:
        existing.event_type = event_type
        existing.title = title
        existing.body = body
        existing.project_id = project_id
        existing.file_id = file_id
        existing.created_at = func.now()

        await session.execute(
            delete(NotificationRead).where(
                NotificationRead.notification_id == existing.id
            )
        )
        await session.execute(
            delete(NotificationDismissal).where(
                NotificationDismissal.notification_id == existing.id
            )
        )
        await session.flush()
        await session.refresh(existing)
        return existing

    notification = Notification(
        event_type=event_type,
        title=title,
        body=body,
        project_id=project_id,
        file_id=file_id,
        job_id=job_id,
    )
    session.add(notification)
    await session.flush()
    return notification


async def publish_notification(
    notification: Notification,
    *,
    organization_id: UUID,
) -> None:
    """Publish a notification on the per-org Redis channel.

    `organization_id` must be passed in because Notification no longer
    carries it as a column — the caller knows which tenant context they
    were in when they created the row.
    """
    payload = json.dumps(
        {
            "id": str(notification.id),
            "organization_id": str(organization_id),
            "project_id": str(notification.project_id) if notification.project_id else None,
            "file_id": str(notification.file_id) if notification.file_id else None,
            "job_id": str(notification.job_id) if notification.job_id else None,
            "event_type": notification.event_type.value,
            "title": notification.title,
            "body": notification.body,
            "created_at": notification.created_at.isoformat() if notification.created_at else None,
        }
    )
    channel = f"{CHANNEL_PREFIX}{organization_id}"
    try:
        redis = get_redis()
        await redis.publish(channel, payload)
    except Exception:
        logger.exception("Failed to publish notification to Redis channel %s", channel)


async def emit_notification_for_org(
    *,
    organization_id: UUID,
    event_type: NotificationEventType,
    title: str,
    body: str,
    project_id: UUID | None = None,
) -> None:
    """Create and publish a notification from a non-tenant context.

    Invitation endpoints use master sessions (``get_async_session``), but
    ``Notification`` lives in the per-org tenant schema.  This helper opens
    a short-lived transaction with ``SET LOCAL search_path`` anchored to the
    target schema — the same pattern ``jobs_internal._emit_notification``
    uses for extraction callbacks.

    Best-effort: a failure here is logged but never masks the calling
    endpoint's response.
    """
    from bimstitch_api.db import get_session_maker
    from bimstitch_api.tenancy import schema_name_for

    try:
        schema = schema_name_for(organization_id)
        sm = get_session_maker()
        async with sm() as session:
            async with session.begin():
                await session.execute(
                    text(f'SET LOCAL search_path TO "{schema}", public')
                )
                notification = await create_notification(
                    session,
                    event_type=event_type,
                    title=title,
                    body=body,
                    project_id=project_id,
                )
        # Publish AFTER commit so the row is visible to readers.
        await publish_notification(notification, organization_id=organization_id)
    except Exception:
        logger.warning(
            "Failed to emit %s notification for org %s",
            event_type.value,
            organization_id,
            exc_info=True,
        )
