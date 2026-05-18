from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimstitch_api.models.borgingsmoment import BorgingsmomentPhase, BorgingsmomentStatus
from bimstitch_api.models.borgingsplan import BorgingsplanStatus
from bimstitch_api.models.checklist_item import ChecklistItemType, EvidenceType

# ----- ChecklistItem schemas -----


class ChecklistItemBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    description: str = Field(min_length=1, max_length=4000)
    evidence_type: EvidenceType
    item_type: ChecklistItemType = ChecklistItemType.text
    bbl_article_ref: str | None = Field(default=None, max_length=50)
    pass_fail_criteria: str | None = Field(default=None, max_length=4000)
    linked_element_global_id: str | None = Field(default=None, max_length=22)
    linked_file_id: UUID | None = None
    extra_data: dict[str, Any] | None = None


class ChecklistItemCreate(ChecklistItemBase):
    sequence: int | None = Field(default=None, ge=0)


class ChecklistItemUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    description: str | None = Field(default=None, min_length=1, max_length=4000)
    evidence_type: EvidenceType | None = None
    item_type: ChecklistItemType | None = None
    bbl_article_ref: str | None = Field(default=None, max_length=50)
    pass_fail_criteria: str | None = Field(default=None, max_length=4000)
    linked_element_global_id: str | None = Field(default=None, max_length=22)
    linked_file_id: UUID | None = None
    extra_data: dict[str, Any] | None = None


class ChecklistItemRead(ChecklistItemBase):
    id: UUID
    borgingsmoment_id: UUID
    project_id: UUID
    sequence: int
    created_at: datetime
    updated_at: datetime


# ----- Borgingsmoment schemas -----


class BorgingsmomentBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    phase: BorgingsmomentPhase
    name: str = Field(min_length=1, max_length=255)
    planned_date: date
    actual_date: date | None = None
    responsible_user_id: UUID | None = None
    notes: str | None = Field(default=None, max_length=4000)


class BorgingsmomentCreate(BorgingsmomentBase):
    sequence_in_phase: int | None = Field(default=None, ge=0)


class BorgingsmomentUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    phase: BorgingsmomentPhase | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    planned_date: date | None = None
    actual_date: date | None = None
    responsible_user_id: UUID | None = None
    status: BorgingsmomentStatus | None = None
    sequence_in_phase: int | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=4000)


class BorgingsmomentRead(BorgingsmomentBase):
    id: UUID
    borgingsplan_id: UUID
    project_id: UUID
    status: BorgingsmomentStatus
    sequence_in_phase: int
    created_at: datetime
    updated_at: datetime
    checklist_items: list[ChecklistItemRead]


# ----- Borgingsplan schemas -----


class BorgingsplanBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    notes: str | None = Field(default=None, max_length=4000)


class BorgingsplanUpdate(BorgingsplanBase):
    pass


class BorgingsplanRead(BorgingsplanBase):
    id: UUID
    project_id: UUID
    version_number: int
    status: BorgingsplanStatus
    created_by_user_id: UUID
    published_at: datetime | None
    superseded_at: datetime | None
    created_at: datetime
    updated_at: datetime
    moments: list[BorgingsmomentRead]


class BorgingsplanVersionSummary(BaseModel):
    """Slim listing for `/borgingsplan/versions` — no nested moments."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    version_number: int
    status: BorgingsplanStatus
    created_by_user_id: UUID
    published_at: datetime | None
    superseded_at: datetime | None
    created_at: datetime
    updated_at: datetime
    notes: str | None


# ----- Action payloads -----


class GenerateOptions(BaseModel):
    force: bool = False


class MomentReorderRequest(BaseModel):
    phase: BorgingsmomentPhase
    moment_ids: list[UUID] = Field(min_length=1)


class ChecklistItemReorderRequest(BaseModel):
    item_ids: list[UUID] = Field(min_length=1)
