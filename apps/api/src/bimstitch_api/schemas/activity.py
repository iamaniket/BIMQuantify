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
