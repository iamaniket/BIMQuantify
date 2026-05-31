from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimstitch_api.models.checklist_item_result import InspectionVerdict


class ResultCreate(BaseModel):
    verdict: InspectionVerdict
    note: str | None = Field(default=None, max_length=4000)
    photo_ids: list[str] | None = None


class ChecklistItemResultRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    checklist_item_id: UUID
    borgingsmoment_id: UUID
    project_id: UUID
    verdict: InspectionVerdict
    note: str | None
    inspector_user_id: UUID
    inspected_at: datetime
    photo_ids: list[str] | None
    voice_note_id: UUID | None
    created_at: datetime
    updated_at: datetime


class InspectionSummaryRead(BaseModel):
    total_items: int
    completed: int
    passed: int
    failed: int
    not_applicable: int
    remaining: int
