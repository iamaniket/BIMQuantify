"""Schemas for free-tier attachments (photo evidence on free snags).

Mirrors `schemas.attachment` but trimmed to the free surface: no dossier slots,
no annotation state, no versioning — just the two-phase presigned upload + a read
model. `CaptureMetadataInput` is reused from the paid schema so the mobile capture
payload (geolocation / exif / device) validates identically.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimdossier_api.schemas._limits import MIME_TYPE_PATTERN
from bimdossier_api.schemas.attachment import CaptureMetadataInput

_HEX_SHA256 = r"^[a-f0-9]{64}$"


class PooledAttachmentInitiateRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    size_bytes: int = Field(ge=1)
    content_type: str = Field(min_length=1, max_length=255, pattern=MIME_TYPE_PATTERN)
    content_sha256: str = Field(pattern=_HEX_SHA256)
    capture_metadata: CaptureMetadataInput | None = None


class PooledAttachmentInitiateResponse(BaseModel):
    attachment_id: UUID
    upload_url: str
    storage_key: str
    expires_in: int


class PooledAttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    pooled_project_id: UUID
    uploaded_by_user_id: UUID | None
    original_filename: str
    size_bytes: int
    content_type: str | None
    content_sha256: str | None
    attachment_category: str
    status: str
    rejection_reason: str | None
    capture_metadata: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime


class PooledAttachmentDownloadResponse(BaseModel):
    download_url: str
    expires_in: int
