from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from bimdossier_api.models.deadline import DeadlineStatus


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


class CalendarDeadlineRead(BaseModel):
    """Org-wide deadline row for the cross-project calendar.

    Carries project context + the localized jurisdiction label so the portal
    can render a single calendar/list across every project without a per-type
    label lookup. ``days_until_due`` is signed (negative = overdue).
    """

    id: UUID
    project_id: UUID
    project_name: str
    country: str
    deadline_type: str
    label: str
    legal_reference: str | None
    due_date: date | None
    status: DeadlineStatus
    is_overdue: bool
    days_until_due: int | None


class DeadlineWeekBucket(BaseModel):
    """Count of pending deadlines whose due date falls in an inclusive day
    range from today (e.g. 0-7, 8-14). Powers the Overview bar chart."""

    days_from: int
    days_to: int
    count: int


class DeadlineSummaryRead(BaseModel):
    """Org-wide deadline aggregates for the calendar Overview KPIs/charts."""

    total: int
    pending: int
    met: int
    not_applicable: int
    overdue: int
    due_this_week: int
    upcoming_buckets: list[DeadlineWeekBucket]
