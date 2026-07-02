from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from bimdossier_api.models.finding import FindingSeverity, FindingStatus
from bimdossier_api.schemas._limits import BoundedAttachmentIds, BoundedExtraData
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
    photo_ids: BoundedAttachmentIds | None = None
    reference_attachment_ids: BoundedAttachmentIds | None = None
    # Custom form template (#templates): the template this finding is created
    # from (null = built-in standard form). `custom_values` are raw answers
    # validated + snapshotted server-side against the template's field defs.
    template_id: UUID | None = None
    custom_values: BoundedExtraData | None = None

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
    photo_ids: BoundedAttachmentIds | None = None
    # Resolution evidence (#26/#27): required (non-empty note + >=1 id) on a
    # transition into `resolved`; the gate is enforced in the router.
    resolution_note: str | None = Field(default=None, max_length=4000)
    resolution_evidence_ids: BoundedAttachmentIds | None = None
    reference_attachment_ids: BoundedAttachmentIds | None = None

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
    duplicate_of_finding_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class FindingBcfExportRequest(BaseModel):
    """Export findings as a BCF archive. Omit `finding_ids` to export them all."""

    finding_ids: list[UUID] | None = Field(default=None, max_length=2000)


class FindingExport(BaseModel):
    """Machine-readable, re-importable export of a project's findings — a
    superset of the CSV (carries 3D/2D anchors, photo/evidence/reference ids,
    template + custom values). Backs the data-portability + instrument-bundle paths."""

    project_id: UUID
    count: int
    findings: list[FindingRead]


class FindingReopen(BaseModel):
    """Re-open a verified finding (a signed-off defect that re-failed).

    Inspector-only, verified→in_progress, with a mandatory reason recorded in
    the history. Keeps `verified` terminal for the normal PATCH path — this is
    the one sanctioned escape hatch.
    """

    reason: str = Field(min_length=1, max_length=4000)


class FindingMarkDuplicate(BaseModel):
    """Mark this finding as a duplicate of `duplicate_of_finding_id`.

    Closes the duplicate (status→resolved) with a synthetic note, bypassing the
    normal resolve evidence gate — the duplicate link is the evidence.
    """

    duplicate_of_finding_id: UUID


class FindingDuplicateCandidate(BaseModel):
    """A pre-existing, still-open finding on the same element — surfaced at
    create time so the inspector can avoid snagging the same defect twice."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    status: FindingStatus
    severity: FindingSeverity
    assignee_user_id: UUID | None
    created_at: datetime


class FindingBulkOp(StrEnum):
    """The mutation a bulk request applies uniformly to every listed finding.

    `set_status` may also carry `assignee_user_id` + `deadline_date` so a batch
    draft→open promotion (which the lifecycle gate requires both for) lands in a
    single call. Language-neutral codes; the portal labels them.
    """

    set_status = "set_status"
    assign = "assign"
    set_deadline = "set_deadline"
    delete = "delete"


class FindingBulkRequest(BaseModel):
    """Apply one operation to many findings at once (coordinator triage).

    Per-row gates (legal transition, promote-needs-deadline+assignee,
    resolve-needs-evidence, verify-needs-inspector) are reused from the
    single-finding path, so an illegal row fails in isolation rather than
    failing the batch — see the 207-style `FindingBulkResult`.
    """

    model_config = ConfigDict(from_attributes=True)

    finding_ids: list[UUID] = Field(min_length=1, max_length=200)
    op: FindingBulkOp
    # Op-specific payload. Validated per-op below so a missing field is a clean
    # 422 VALIDATION_ERROR (no new error code needed).
    status: FindingStatus | None = None
    assignee_user_id: UUID | None = None
    deadline_date: date | None = None

    @model_validator(mode="after")
    def _require_op_fields(self) -> FindingBulkRequest:
        if self.op is FindingBulkOp.set_status and self.status is None:
            raise ValueError("op=set_status requires `status`")
        if self.op is FindingBulkOp.set_deadline and self.deadline_date is None:
            raise ValueError("op=set_deadline requires `deadline_date`")
        # op=assign with assignee_user_id=None is a deliberate bulk un-assign.
        return self


class FindingBulkItemResult(BaseModel):
    """Outcome for a single finding in a bulk request."""

    finding_id: UUID
    status: Literal["ok", "error"]
    # The audit action applied (finding.promoted/resolved/verified/updated/deleted)
    # on success; the domain error code (e.g. FINDING_ILLEGAL_TRANSITION) on failure.
    action: str | None = None
    error_code: str | None = None


class FindingBulkResult(BaseModel):
    """207-style aggregate result: per-row success/failure plus tallies. The
    HTTP status is 200 when every row succeeded, 207 when any row failed."""

    results: list[FindingBulkItemResult]
    succeeded: int
    failed: int


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
