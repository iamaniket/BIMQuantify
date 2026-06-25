from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimdossier_api.models.project_file import (
    AttachmentCategory,
    DossierSlot,
    ProjectFileRole,
    ProjectFileStatus,
)

_HEX_SHA256 = r"^[a-f0-9]{64}$"


class GeolocationData(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy: float | None = None
    altitude: float | None = None
    altitude_accuracy: float | None = None
    low_accuracy: bool = False


class ExifData(BaseModel):
    make: str | None = None
    model: str | None = None
    date_time_original: str | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    orientation: int | None = None
    image_width: int | None = None
    image_height: int | None = None
    focal_length: float | None = None
    f_number: float | None = None
    iso: int | None = None
    exposure_time: str | None = None
    flash: bool | None = None
    software: str | None = None


class CaptureMetadataInput(BaseModel):
    captured_at: str | None = None
    capture_method: str | None = Field(default=None, pattern=r"^(camera|file_picker|drag_drop)$")
    device: dict[str, Any] | None = None
    geolocation: GeolocationData | None = None
    exif: ExifData | None = None


class AttachmentInitiateRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    size_bytes: int = Field(ge=1)
    content_type: str = Field(min_length=1, max_length=255)
    content_sha256: str = Field(pattern=_HEX_SHA256)
    description: str | None = Field(default=None, max_length=2000)
    dossier_slot: DossierSlot | None = None
    capture_metadata: CaptureMetadataInput | None = None
    # When set, this upload supersedes an existing attachment: the new row joins
    # that document's version group as the next version instead of starting a new
    # one. May reference any version in the group; the root is resolved server-side.
    supersedes_id: UUID | None = None


class AttachmentInitiateResponse(BaseModel):
    attachment_id: UUID
    upload_url: str
    storage_key: str
    expires_in: int


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    uploaded_by_user_id: UUID | None
    uploaded_by_name: str | None
    capture_link_id: UUID | None
    original_filename: str
    size_bytes: int
    content_type: str
    content_sha256: str | None
    role: ProjectFileRole
    attachment_category: AttachmentCategory | None
    status: ProjectFileStatus
    rejection_reason: str | None
    description: str | None
    dossier_slot: DossierSlot | None
    capture_metadata: dict[str, Any] | None
    server_metadata: dict[str, Any] | None
    annotation_state: dict[str, Any] | None
    version_number: int
    parent_file_id: UUID | None
    created_at: datetime
    updated_at: datetime


class AttachmentUpdateRequest(BaseModel):
    description: str | None = Field(default=None, max_length=2000)
    dossier_slot: DossierSlot | None = None
    # Vector annotation document (Annotation2D[] + schema/source-version). Stored
    # verbatim; `exclude_unset` in the router means omitting it leaves it untouched.
    annotation_state: dict[str, Any] | None = None


class AttachmentCallbackRequest(BaseModel):
    attachment_id: UUID
    organization_id: UUID
    job_id: UUID
    status: Literal["running", "succeeded", "failed"]
    server_metadata: dict[str, Any] | None = None
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    # 0-100 progress, sent on `running` callbacks at pipeline stage boundaries.
    progress: int | None = Field(default=None, ge=0, le=100)
    # On `failed`: whether retrying could plausibly succeed, plus a classifier tag.
    retriable: bool = False
    error_kind: str | None = None


class AttachmentDownloadResponse(BaseModel):
    download_url: str
    expires_in: int
