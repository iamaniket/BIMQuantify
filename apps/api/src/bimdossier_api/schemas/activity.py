from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class ProjectActivityEntry(BaseModel):
    id: UUID
    action: str
    category: str
    actor_user_id: UUID | None
    actor_name: str | None
    resource_type: str
    resource_id: str | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    created_at: datetime


class ActivityTimelineBucket(BaseModel):
    """One time bucket of the project activity-over-time trend.

    Only buckets with at least one event are returned (ascending by
    ``bucket_start``); the client zero-fills gaps over its fixed time axis.

    ``by_category`` and ``by_resource`` break the bucket's ``count`` down so the
    chart can render a per-point hover tooltip ("10 activities — 4 created,
    3 changes … · 5 findings, 3 reports"). Both carry only non-zero entries and
    each sums to ``count``.
    """

    bucket_start: datetime
    count: int
    by_category: dict[str, int]
    by_resource: dict[str, int]
