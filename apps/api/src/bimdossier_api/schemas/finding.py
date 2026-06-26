from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from bimdossier_api.models.finding import FindingSeverity, FindingStatus
from bimdossier_api.schemas.anchor import validate_linked_anchor


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
    # element in the viewer so it round-trips to the 3D model. `linked_document_id`
    # is the version-independent identity (the finding follows the element across
    # versions); `linked_file_id` records which version it was first raised on.
    linked_document_id: UUID | None = None
    linked_file_id: UUID | None = None
    linked_element_global_id: str | None = Field(default=None, max_length=255)
    # Anchor geometry — dedicated fields keyed by linked_file_type (see
    # schemas/anchor.py); validated together below.
    linked_file_type: str | None = None
    anchor_x: float | None = None
    anchor_y: float | None = None
    anchor_z: float | None = None
    anchor_page: int | None = None
    # Attachment ids (photos) captured while logging the finding. A string list
    # on the wire — match ChecklistItemResult.photo_ids — normalized to link
    # rows server-side.
    photo_ids: list[str] | None = None
    reference_attachment_ids: list[str] | None = None
    # Custom form template (#templates): the template this finding is created
    # from (null = built-in standard form). `custom_values` are raw answers
    # validated + snapshotted server-side against the template's field defs.
    template_id: UUID | None = None
    custom_values: dict[str, object] | None = None

    @model_validator(mode="after")
    def _validate_anchor(self) -> FindingCreate:
        validate_linked_anchor(
            self.linked_file_type,
            anchor_x=self.anchor_x,
            anchor_y=self.anchor_y,
            anchor_z=self.anchor_z,
            anchor_page=self.anchor_page,
        )
        return self


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
    # Element link (#49): PATCH to link/relink; send null to unlink. Re-mapping
    # an orphaned finding (element absent from a new version) sets these.
    linked_document_id: UUID | None = None
    linked_file_id: UUID | None = None
    linked_element_global_id: str | None = Field(default=None, max_length=255)
    linked_file_type: str | None = None
    anchor_x: float | None = None
    anchor_y: float | None = None
    anchor_z: float | None = None
    anchor_page: int | None = None
    # Replace the photo set (add/remove). Omit to leave unchanged.
    photo_ids: list[str] | None = None
    # Resolution evidence (#26/#27): required (non-empty note + >=1 id) on a
    # transition into `resolved`; the gate is enforced in the router.
    resolution_note: str | None = Field(default=None, max_length=4000)
    resolution_evidence_ids: list[str] | None = None
    reference_attachment_ids: list[str] | None = None

    @model_validator(mode="after")
    def _validate_anchor(self) -> FindingUpdate:
        validate_linked_anchor(
            self.linked_file_type,
            anchor_x=self.anchor_x,
            anchor_y=self.anchor_y,
            anchor_z=self.anchor_z,
            anchor_page=self.anchor_page,
        )
        return self


class FindingRead(FindingBase):
    id: UUID
    project_id: UUID
    status: FindingStatus
    assignee_user_id: UUID | None
    deadline_date: date | None
    created_by_user_id: UUID
    source_checklist_item_id: UUID | None
    borgingsmoment_id: UUID | None
    linked_document_id: UUID | None
    linked_file_id: UUID | None
    linked_element_global_id: str | None
    linked_file_type: str | None
    anchor_x: float | None
    anchor_y: float | None
    anchor_z: float | None
    anchor_page: int | None
    anchor_page_id: UUID | None
    photo_ids: list[str] | None
    resolution_note: str | None
    resolution_evidence_ids: list[str] | None
    reference_attachment_ids: list[str] | None
    template_id: UUID | None
    custom_values: dict[str, object] | None
    created_at: datetime
    updated_at: datetime


class FindingHistoryChange(BaseModel):
    """One field-level change within a finding history entry, diffed from the
    audit `before`/`after` snapshots.

    Values are stringified server-side; the portal maps `field` to a localized
    label and renders `from_value` -> `to_value` (resolving ids, dates, counts
    and enum values for display). `None` means the field was empty on that side.
    """

    field: str
    from_value: str | None
    to_value: str | None


class FindingHistoryEntry(BaseModel):
    """One row of a finding's lifecycle timeline, derived from `audit_log`.

    `from_status`/`to_status` are pulled out of the audit `before`/`after`
    snapshots so the portal can render "open -> resolved" transitions without
    re-deriving them client-side. `changes` carries the field-level diff (what
    actually changed, e.g. deadline or photos) for the same entry. Actor
    name/email are resolved from `public.users` (null when the actor row was
    deleted).
    """

    id: UUID
    action: str
    actor_user_id: UUID | None
    actor_name: str | None
    actor_email: str | None
    from_status: str | None
    to_status: str | None
    changes: list[FindingHistoryChange] = []
    created_at: datetime
