from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from bimstitch_api.models.deadline import DeadlineStatus


class DeadlineRead(BaseModel):
    """Public representation of a project deadline."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    deadline_type: str
    due_date: date | None
    status: DeadlineStatus
    met_at: datetime | None
    met_by_user_id: UUID | None
    is_overdue: bool
    created_at: datetime
    updated_at: datetime


class DeadlineMarkMet(BaseModel):
    """Body for PATCH /projects/{project_id}/deadlines/{deadline_id} (mark as met)."""

    # Intentionally empty — marking as met doesn't require extra input.
    # The server fills met_at + met_by_user_id from the auth context.
    pass
