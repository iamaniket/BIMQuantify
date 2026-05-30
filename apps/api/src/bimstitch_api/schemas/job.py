from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from bimstitch_api.models.job import JobStatus, JobType


class JobListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID | None
    file_id: UUID | None
    job_type: JobType
    status: JobStatus
    error: str | None
    retriable: bool
    error_kind: str | None
    progress: int
    retry_of: UUID | None
    attempt: int
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime
    created_by_user_id: UUID | None


class JobRead(JobListItem):
    payload: dict
    result: dict | None


class JobListResponse(BaseModel):
    items: list[JobListItem]
    total: int
    limit: int
    offset: int
