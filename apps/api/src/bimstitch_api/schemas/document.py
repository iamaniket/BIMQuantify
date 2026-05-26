from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimstitch_api.models.document import DocumentCategory, DocumentStatus

_HEX_SHA256 = r"^[a-f0-9]{64}$"


class DocumentInitiateRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    size_bytes: int = Field(ge=1)
    content_type: str = Field(min_length=1, max_length=255)
    content_sha256: str = Field(pattern=_HEX_SHA256)
    description: str | None = Field(default=None, max_length=2000)
    linked_element_global_id: str | None = Field(default=None, max_length=22)
    linked_model_id: UUID | None = None
    linked_point: dict[str, Any] | None = None
    linked_file_id: UUID | None = None


class DocumentInitiateResponse(BaseModel):
    document_id: UUID
    upload_url: str
    storage_key: str
    expires_in: int


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    uploaded_by_user_id: UUID | None
    capture_link_id: UUID | None
    original_filename: str
    size_bytes: int
    content_type: str
    content_sha256: str | None
    document_category: DocumentCategory
    status: DocumentStatus
    rejection_reason: str | None
    description: str | None
    linked_element_global_id: str | None
    linked_model_id: UUID | None
    linked_point: dict[str, Any] | None
    linked_file_id: UUID | None
    version_number: int
    parent_document_id: UUID | None
    created_at: datetime
    updated_at: datetime


class DocumentUpdateRequest(BaseModel):
    description: str | None = Field(default=None, max_length=2000)
    linked_element_global_id: str | None = Field(default=None, max_length=22)
    linked_model_id: UUID | None = None
    linked_point: dict[str, Any] | None = None
    linked_file_id: UUID | None = None


class DocumentDownloadResponse(BaseModel):
    download_url: str
    expires_in: int
