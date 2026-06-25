from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from bimdossier_api.models.certificate import CertificateStatus, CertificateType

_HEX_SHA256 = r"^[a-f0-9]{64}$"


class CertificateInitiateRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    size_bytes: int = Field(ge=1)
    content_type: str = Field(min_length=1, max_length=255)
    content_sha256: str = Field(pattern=_HEX_SHA256)
    certificate_type: CertificateType
    certificate_number: str | None = Field(default=None, max_length=255)
    issuer: str | None = Field(default=None, max_length=255)
    subject: str | None = Field(default=None, max_length=2000)
    valid_from: date | None = None
    valid_until: date | None = None
    description: str | None = Field(default=None, max_length=2000)
    # When set, supersede an existing certificate: the new row joins that
    # certificate's version group as the next version. May reference any version
    # in the group; the root is resolved server-side.
    supersedes_id: UUID | None = None

    @model_validator(mode="after")
    def _check_validity_window(self) -> CertificateInitiateRequest:
        if (
            self.valid_from is not None
            and self.valid_until is not None
            and self.valid_until < self.valid_from
        ):
            raise ValueError("valid_until must not be earlier than valid_from")
        return self


class CertificateInitiateResponse(BaseModel):
    certificate_id: UUID
    upload_url: str
    storage_key: str
    expires_in: int


class CertificateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    uploaded_by_user_id: UUID | None
    uploaded_by_name: str | None
    original_filename: str
    size_bytes: int
    content_type: str
    content_sha256: str | None
    certificate_type: CertificateType
    status: CertificateStatus
    rejection_reason: str | None
    description: str | None
    certificate_number: str | None
    issuer: str | None
    subject: str | None
    valid_from: date | None
    valid_until: date | None
    org_certificate_id: UUID | None
    version_number: int
    parent_certificate_id: UUID | None
    created_at: datetime
    updated_at: datetime


class CertificateUpdateRequest(BaseModel):
    certificate_type: CertificateType | None = None
    certificate_number: str | None = Field(default=None, max_length=255)
    issuer: str | None = Field(default=None, max_length=255)
    subject: str | None = Field(default=None, max_length=2000)
    valid_from: date | None = None
    valid_until: date | None = None
    description: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _check_validity_window(self) -> CertificateUpdateRequest:
        if (
            self.valid_from is not None
            and self.valid_until is not None
            and self.valid_until < self.valid_from
        ):
            raise ValueError("valid_until must not be earlier than valid_from")
        return self


class CertificateDownloadResponse(BaseModel):
    download_url: str
    expires_in: int
