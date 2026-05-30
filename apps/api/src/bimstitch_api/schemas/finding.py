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
    # Attachment ids (photos) captured while logging the finding. Stored as a
    # JSONB string list — match ChecklistItemResult.photo_ids, so values stay
    # JSON-serializable (str, not UUID).
    photo_ids: list[str] | None = None


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
    # Replace the photo set (add/remove). Omit to leave unchanged.
    photo_ids: list[str] | None = None
    # Resolution evidence (#26/#27): required (non-empty note + >=1 id) on a
    # transition into `resolved`; the gate is enforced in the router.
    resolution_note: str | None = Field(default=None, max_length=4000)
    resolution_evidence_ids: list[str] | None = None


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
    photo_ids: list[str] | None
    resolution_note: str | None
    resolution_evidence_ids: list[str] | None
    created_at: datetime
    updated_at: datetime


class FindingHistoryEntry(BaseModel):
    """One row of a finding's lifecycle timeline, derived from `audit_log`.

    `from_status`/`to_status` are pulled out of the audit `before`/`after`
    snapshots so the portal can render "open -> resolved" transitions without
    re-deriving them client-side. Actor name/email are resolved from
    `public.users` (null when the actor row was deleted).
    """

    id: UUID
    action: str
    actor_user_id: UUID | None
    actor_name: str | None
    actor_email: str | None
    from_status: str | None
    to_status: str | None
    created_at: datetime
