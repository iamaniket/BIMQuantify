from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimstitch_api.models.risk import RiskCategory, RiskLevel


class RiskBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    category: RiskCategory
    level: RiskLevel
    description: str = Field(min_length=1, max_length=2000)
    mitigation: str = Field(min_length=1, max_length=2000)
    responsible_party: str | None = Field(default=None, max_length=255)
    bbl_article_ref: str | None = Field(default=None, max_length=50)


class RiskCreate(RiskBase):
    pass


class RiskUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    category: RiskCategory | None = None
    level: RiskLevel | None = None
    description: str | None = Field(default=None, min_length=1, max_length=2000)
    mitigation: str | None = Field(default=None, min_length=1, max_length=2000)
    responsible_party: str | None = Field(default=None, max_length=255)
    bbl_article_ref: str | None = Field(default=None, max_length=50)


class RiskRead(RiskBase):
    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime
