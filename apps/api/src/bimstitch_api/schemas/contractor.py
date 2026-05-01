from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ContractorBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str = Field(min_length=1, max_length=255)
    kvk_number: str | None = Field(default=None, max_length=20)
    contact_email: str | None = Field(default=None, max_length=320)
    contact_phone: str | None = Field(default=None, max_length=50)


class ContractorCreate(ContractorBase):
    pass


class ContractorUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str | None = Field(default=None, min_length=1, max_length=255)
    kvk_number: str | None = Field(default=None, max_length=20)
    contact_email: str | None = Field(default=None, max_length=320)
    contact_phone: str | None = Field(default=None, max_length=50)


class ContractorRead(ContractorBase):
    id: UUID
    organization_id: UUID
    created_at: datetime
    updated_at: datetime
