from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from bimstitch_api.models.project_file import (
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


class LinkedPointIfc(BaseModel):
    type: str = Field(pattern=r"^ifc$")
    x: float
    y: float
    z: float


class LinkedPointPdf(BaseModel):
    type: str = Field(pattern=r"^pdf$")
    page: int = Field(ge=1)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


def _validate_linked_point(v: dict[str, Any] | None) -> dict[str, Any] | None:
    if v is None:
        return None
    point_type = v.get("type")
    if point_type == "ifc":
        LinkedPointIfc.model_validate(v)
    elif point_type == "pdf":
        LinkedPointPdf.model_validate(v)
    else:
        raise ValueError(f"linked_point.type must be 'ifc' or 'pdf', got '{point_type}'")
    return v


class AttachmentInitiateRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    size_bytes: int = Field(ge=1)
    content_type: str = Field(min_length=1, max_length=255)
    content_sha256: str = Field(pattern=_HEX_SHA256)
    description: str | None = Field(default=None, max_length=2000)
    dossier_slot: DossierSlot | None = None
    linked_element_global_id: str | None = Field(default=None, max_length=22)
    linked_model_id: UUID | None = None
    linked_point: dict[str, Any] | None = None
    linked_file_id: UUID | None = None
    capture_metadata: CaptureMetadataInput | None = None
    # When set, this upload supersedes an existing attachment: the new row joins
    # that document's version group as the next version instead of starting a new
    # one. May reference any version in the group; the root is resolved server-side.
    supersedes_id: UUID | None = None

    @field_validator("linked_point")
    @classmethod
    def validate_linked_point(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_linked_point(v)


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
    linked_element_global_id: str | None
    linked_model_id: UUID | None
    linked_point: dict[str, Any] | None
    linked_file_id: UUID | None
    capture_metadata: dict[str, Any] | None
    server_metadata: dict[str, Any] | None
    version_number: int
    parent_file_id: UUID | None
    created_at: datetime
    updated_at: datetime


class AttachmentUpdateRequest(BaseModel):
    description: str | None = Field(default=None, max_length=2000)
    dossier_slot: DossierSlot | None = None
    linked_element_global_id: str | None = Field(default=None, max_length=22)
    linked_model_id: UUID | None = None
    linked_point: dict[str, Any] | None = None
    linked_file_id: UUID | None = None


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
