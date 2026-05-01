from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from bimstitch_api.models.job import JobStatus, JobType


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    project_id: UUID | None
    file_id: UUID | None
    job_type: JobType
    status: JobStatus
    payload: dict
    result: dict | None
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime
    created_by_user_id: UUID | None


class JobListResponse(BaseModel):
    items: list[JobRead]
    total: int
    limit: int
    offset: int
