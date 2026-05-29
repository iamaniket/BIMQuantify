from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimstitch_api.models.finding import FindingSeverity, FindingStatus


class FindingBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1, max_length=4000)
    severity: FindingSeverity = FindingSeverity.medium
    bbl_article_ref: str | None = Field(default=None, max_length=50)


class FindingCreate(FindingBase):
    # Manual findings (aannemer pivot) leave these null; supplied when a
    # finding is captured against a specific moment / checklist item.
    source_checklist_item_id: UUID | None = None
    borgingsmoment_id: UUID | None = None
    # Element link (#49): set when a finding is created against a specific IFC
    # element in the viewer so it round-trips to the 3D model.
    linked_file_id: UUID | None = None
    linked_element_global_id: str | None = Field(default=None, max_length=255)


class FindingUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, min_length=1, max_length=4000)
    severity: FindingSeverity | None = None
    bbl_article_ref: str | None = Field(default=None, max_length=50)
    # Promotion fields: setting status -> open requires deadline + assignee
    # (enforced in the router, not here, so the message is a domain 422).
    status: FindingStatus | None = None
    assignee_user_id: UUID | None = None
    deadline_date: date | None = None
    # Element link (#49): PATCH to link/relink; send null to unlink.
    linked_file_id: UUID | None = None
    linked_element_global_id: str | None = Field(default=None, max_length=255)


class FindingRead(FindingBase):
    id: UUID
    project_id: UUID
    status: FindingStatus
    assignee_user_id: UUID | None
    deadline_date: date | None
    created_by_user_id: UUID
    source_checklist_item_id: UUID | None
    borgingsmoment_id: UUID | None
    linked_file_id: UUID | None
    linked_element_global_id: str | None
    created_at: datetime
    updated_at: datetime
