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
    reference_number: str | None
    filing_notes: str | None
    filed_at: datetime | None
    is_overdue: bool
    created_at: datetime
    updated_at: datetime


class DeadlineFileMet(BaseModel):
    """Body for PATCH /projects/{project_id}/deadlines/{deadline_id}.

    All fields optional for backward compatibility — existing callers
    sending ``{}`` continue to work.
    """

    reference_number: str | None = None
    filing_notes: str | None = None
