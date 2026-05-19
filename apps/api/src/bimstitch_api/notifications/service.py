import json
import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.cache import get_redis
from bimstitch_api.models.notification import Notification, NotificationEventType

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
