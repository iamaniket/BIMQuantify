from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from bimdossier_api.auth.free_domains import is_free_email_domain
from bimdossier_api.models.access_request import AccessRequestStatus

_ALLOWED_COMPANY_SIZES = {"1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"}


class AccessRequestCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    work_email: EmailStr
    company: str = Field(min_length=2, max_length=255)
    role: str = Field(min_length=1, max_length=120)
    company_size: str = Field(min_length=1, max_length=20)
    country: str = Field(min_length=2, max_length=2)
    notes: str | None = Field(default=None, max_length=2000)
    terms_accepted: bool

    @field_validator("name")
    @classmethod
    def _name_has_two_tokens(cls, value: str) -> str:
        tokens = [t for t in value.strip().split() if t]
        if len(tokens) < 2:
            raise ValueError("Use your full name (first and last).")
        return " ".join(tokens)

    @field_validator("work_email")
    @classmethod
    def _reject_free_email(cls, value: str) -> str:
        if is_free_email_domain(value):
            raise ValueError("Please use your work email — not a personal address.")
        return value.lower()

    @field_validator("company_size")
    @classmethod
    def _normalise_size(cls, value: str) -> str:
        normalised = value.replace("–", "-").replace("—", "-").strip()
        if normalised not in _ALLOWED_COMPANY_SIZES:
            raise ValueError(
                f"company_size must be one of: {', '.join(sorted(_ALLOWED_COMPANY_SIZES))}"
            )
        return normalised

    @field_validator("country")
    @classmethod
    def _country_uppercase(cls, value: str) -> str:
        return value.upper()

    @field_validator("terms_accepted")
    @classmethod
    def _terms_required(cls, value: bool) -> bool:
        if not value:
            raise ValueError("You must accept the terms to continue.")
        return value


class AccessRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    work_email: str
    company: str
    role: str
    company_size: str
    country: str
    notes: str | None
    status: AccessRequestStatus
    created_at: datetime
