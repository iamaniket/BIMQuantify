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
    organization_id: UUID,
    event_type: NotificationEventType,
    title: str,
    body: str,
    project_id: UUID | None = None,
    file_id: UUID | None = None,
    job_id: UUID | None = None,
) -> Notification:
    notification = Notification(
        organization_id=organization_id,
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


async def publish_notification(notification: Notification) -> None:
    payload = json.dumps(
        {
            "id": str(notification.id),
            "organization_id": str(notification.organization_id),
            "project_id": str(notification.project_id) if notification.project_id else None,
            "file_id": str(notification.file_id) if notification.file_id else None,
            "job_id": str(notification.job_id) if notification.job_id else None,
            "event_type": notification.event_type.value,
            "title": notification.title,
            "body": notification.body,
            "created_at": notification.created_at.isoformat() if notification.created_at else None,
        }
    )
    channel = f"{CHANNEL_PREFIX}{notification.organization_id}"
    try:
        redis = get_redis()
        await redis.publish(channel, payload)
    except Exception:
        logger.exception("Failed to publish notification to Redis channel %s", channel)
