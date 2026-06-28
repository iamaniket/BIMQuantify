from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from bimdossier_api.models.notification import NotificationEventType


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    project_id: UUID | None
    file_id: UUID | None
    job_id: UUID | None
    event_type: NotificationEventType
    title: str
    body: str
    is_read: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationOut]
    total: int
    unread_count: int
    limit: int
    offset: int
    # Opaque keyset cursor for "load more": pass it back as ?cursor= to fetch the
    # next page without an OFFSET scan. None when there are no more rows. Offset
    # paging still works (omit cursor) — this is additive.
    next_cursor: str | None = None


class UnreadCountResponse(BaseModel):
    count: int
