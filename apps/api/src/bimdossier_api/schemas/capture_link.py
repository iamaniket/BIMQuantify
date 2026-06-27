from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimdossier_api.schemas.attachment import CaptureMetadataInput


class CreateCaptureLinkRequest(BaseModel):
    label: str | None = Field(default=None, max_length=255)
    ttl_hours: int = Field(default=72, ge=1, le=720)
    max_uses: int | None = Field(default=None, ge=1)


class CreateCaptureLinkResponse(BaseModel):
    id: UUID
    token: str
    url: str
    expires_at: datetime
    label: str | None
    max_uses: int | None


class CaptureLinkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    created_by_user_id: UUID
    label: str | None
    expires_at: datetime
    revoked_at: datetime | None
    max_uses: int | None
    use_count: int
    created_at: datetime
    # The shareable upload URL, rebuilt per request from the active org id + token
    # so authorized members can re-copy a link after creation. None when the
    # caller did not provide org context (defensive; the list handler always sets it).
    url: str | None = None


class CaptureTokenValidation(BaseModel):
    project_id: UUID
    project_name: str
    label: str | None
    expires_at: datetime
    remaining_uses: int | None


class CaptureUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    size_bytes: int = Field(ge=1)
    content_type: str = Field(min_length=1, max_length=255)
    content_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    capture_metadata: CaptureMetadataInput | None = None


class CaptureUploadResponse(BaseModel):
    attachment_id: UUID
    upload_url: str
    storage_key: str
    expires_in: int
