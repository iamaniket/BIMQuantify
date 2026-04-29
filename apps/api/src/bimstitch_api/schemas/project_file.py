from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimstitch_api.models.project_file import (
    ExtractionStatus,
    IfcSchema,
    ProjectFileStatus,
)


class InitiateUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    size_bytes: int = Field(ge=1)
    content_type: str = Field(min_length=1, max_length=255)


class InitiateUploadResponse(BaseModel):
    file_id: UUID
    upload_url: str
    storage_key: str
    expires_in: int


class ProjectFileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    uploaded_by_user_id: UUID
    original_filename: str
    size_bytes: int
    content_type: str
    ifc_schema: IfcSchema | None
    status: ProjectFileStatus
    rejection_reason: str | None
    extraction_status: ExtractionStatus
    extraction_error: str | None
    extraction_started_at: datetime | None
    extraction_finished_at: datetime | None
    extractor_version: str | None
    created_at: datetime
    updated_at: datetime


class ProjectFileDownloadResponse(BaseModel):
    download_url: str
    expires_in: int


class ViewerBundleResponse(BaseModel):
    fragments_url: str
    metadata_url: str | None
    properties_url: str | None
    expires_in: int


# ---------------------------------------------------------------------------
# Internal extractor callback
# ---------------------------------------------------------------------------


class ExtractionCallbackRequest(BaseModel):
    file_id: UUID
    # Allow `running` so the extractor can announce it has started, plus the
    # two terminal states. `queued` and `not_started` are not valid here — the
    # API owns those transitions.
    status: ExtractionStatus = Field(
        description="One of running, succeeded, failed."
    )
    fragments_key: str | None = None
    metadata_key: str | None = None
    properties_key: str | None = None
    error: str | None = None
    extractor_version: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
