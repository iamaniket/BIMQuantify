from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimstitch_api.models.attachment import AttachmentCategory, AttachmentStatus

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
    linked_element_global_id: str | None = Field(default=None, max_length=22)
    linked_model_id: UUID | None = None
    linked_point: dict[str, Any] | None = None
    linked_file_id: UUID | None = None
    capture_metadata: CaptureMetadataInput | None = None


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
    attachment_category: AttachmentCategory
    status: AttachmentStatus
    rejection_reason: str | None
    description: str | None
    linked_element_global_id: str | None
    linked_model_id: UUID | None
    linked_point: dict[str, Any] | None
    linked_file_id: UUID | None
    capture_metadata: dict[str, Any] | None
    version_number: int
    parent_attachment_id: UUID | None
    created_at: datetime
    updated_at: datetime


class AttachmentUpdateRequest(BaseModel):
    description: str | None = Field(default=None, max_length=2000)
    linked_element_global_id: str | None = Field(default=None, max_length=22)
    linked_model_id: UUID | None = None
    linked_point: dict[str, Any] | None = None
    linked_file_id: UUID | None = None


class AttachmentDownloadResponse(BaseModel):
    download_url: str
    expires_in: int
