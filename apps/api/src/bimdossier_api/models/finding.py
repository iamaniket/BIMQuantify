from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import SoftDeleteMixin, TimestampMixin
from bimdossier_api.models.user import User

if TYPE_CHECKING:
    from bimdossier_api.models.finding_attachment import FindingAttachment
    from bimdossier_api.models.project import Project


class FindingSeverity(StrEnum):
    # Neutral severity codes. Dutch labels (laag/midden/hoog) live in the
    # portal i18n catalog — these are project-static UI strings, not
    # jurisdiction data. Dedicated to findings (not shared with RiskLevel)
    # so the two domains can diverge without coupling.
    low = "low"
    medium = "medium"
    high = "high"


class FindingStatus(StrEnum):
    # Language-neutral lifecycle codes. Dutch display
    # labels live in the portal i18n catalog:
    #   open -> "open", in_progress -> "in behandeling",
    #   resolved -> "opgelost", verified -> "geverifieerd".
    # The full set is declared now so the #26 status state-machine needs no
    # migration; #25 only ever writes `draft` and `open`.
    draft = "draft"
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"
    verified = "verified"


class Finding(TimestampMixin, SoftDeleteMixin, TenantBase):
    """A bevinding — a human inspection finding/defect.

    First-class object (not a sub-record of an inspection): one defect is
    tracked across multiple borgingsmomenten / phases. Manual findings leave
    `source_checklist_item_id` null; the future auto-draft hook (#22, KB mode)
    sets it to dedupe one draft per failed checklist item.
    """

    __tablename__ = "findings"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[FindingSeverity] = mapped_column(
        SAEnum(
            FindingSeverity,
            name="findingseverity",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=FindingSeverity.medium,
    )
    status: Mapped[FindingStatus] = mapped_column(
        SAEnum(
            FindingStatus,
            name="findingstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=FindingStatus.draft,
    )
    assignee_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    deadline_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    bbl_article_ref: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    source_checklist_item_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("checklist_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    borgingsmoment_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borgingsmomenten.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Version-independent element identity (#N9): findings attach to an IFC
    # element by (document, GlobalId), not to one file version. `linked_file_id`
    # below stays as provenance — "first raised on this version" — while
    # `linked_document_id` is what the element panels query so a finding follows
    # the element across re-uploaded versions. Mirrors Attachment/Certificate.
    linked_document_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    linked_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="SET NULL"),
        nullable=True,
    )
    linked_element_global_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Anchor geometry — dedicated columns (no JSONB). The active set is keyed by
    # linked_file_type (see schemas/anchor.py):
    #   ifc     -> anchor_x/y/z (3D world meters)
    #   pdf     -> anchor_page (>=1) + anchor_x/y (normalized 0..1)
    #   image   -> anchor_x/y (normalized 0..1)
    #   dxf/dwg -> anchor_x/y (drawing model-space units)
    # linked_file_type is the single source of truth for which columns are set;
    # String + CHECK (not an enum) because the value set grows.
    anchor_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_z: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    linked_file_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Normalized pointer to the logical PdfPage this finding anchors to. Set only
    # when `linked_file_id` is a model_source PDF (which has a document_id); NULL
    # for attachment-PDF and non-PDF anchors. Additive — `anchor_page` (1-indexed)
    # stays authoritative for display + marker matching. SET NULL so deleting a
    # page just clears the pointer (the finding keeps its anchor_page).
    anchor_page_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("pdf_pages.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Resolution evidence (#26/#27): a transition into `resolved` requires both
    # a written note and >=1 evidence attachment.
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Duplicate linkage: when two inspectors snag the same defect (or it recurs
    # across model versions), the redundant finding is marked a duplicate of the
    # canonical one. SET NULL so deleting the canonical finding just unlinks the
    # duplicate (it keeps its own history). Closing-as-duplicate is a dedicated
    # action (POST .../mark-duplicate) that bypasses the resolve evidence gate —
    # the link itself is the evidence — so the dossier isn't inflated by dupes.
    duplicate_of_finding_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("findings.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Custom form template (#templates): the OrgTemplate (findings kind) this
    # finding was created from. Null = the built-in "standard form". SET NULL so a
    # template can be soft-deleted without blocking; `custom_values` snapshots the
    # labels so the finding stays renderable even when the template row is gone.
    template_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("org_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Answers to the template's custom fields, snapshotted as
    #   {field_id: {"label": str, "type": str, "value": Any}}
    # Genuinely dynamic, schema-less form answers → JSONB (cf. Job.payload).
    custom_values: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Offline-replay dedup (mobile outbox). NULL for online (portal) creates and
    # every pre-existing row. When a mobile client replays a queued create after
    # a lost response, it re-sends the same client-minted key here; the per-user
    # partial-unique index below makes the second insert a no-op the route turns
    # into "return the original finding". See bimdossier_api/idempotency.py.
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)

    project: Mapped["Project"] = relationship()
    assignee: Mapped[User | None] = relationship(User, foreign_keys=[assignee_user_id])
    created_by: Mapped[User] = relationship(User, foreign_keys=[created_by_user_id])
    # Attachment links — normalize the former photo_ids / resolution_evidence_ids
    # / reference_attachment_ids JSONB arrays. `kind` discriminates the role.
    # Eager-loaded (selectin) so the read-only id properties below are always
    # populated when a finding is serialized.
    attachment_links: Mapped[list["FindingAttachment"]] = relationship(
        back_populates="finding",
        cascade="all, delete-orphan",
        order_by="FindingAttachment.position",
        lazy="selectin",
    )

    def _attachment_ids(self, kind: str) -> list[str] | None:
        ids = [str(link.attachment_id) for link in self.attachment_links if link.kind == kind]
        return ids or None

    @property
    def photo_ids(self) -> list[str] | None:
        return self._attachment_ids("photo")

    @property
    def resolution_evidence_ids(self) -> list[str] | None:
        return self._attachment_ids("resolution_evidence")

    @property
    def reference_attachment_ids(self) -> list[str] | None:
        return self._attachment_ids("reference")

    __table_args__ = (
        CheckConstraint(
            "linked_file_type IS NULL OR linked_file_type IN ('ifc','pdf','dxf','dwg','image')",
            name="ck_findings_linked_file_type",
        ),
        Index("ix_findings_project_id", "project_id"),
        Index("ix_findings_project_status", "project_id", "status"),
        # Drives the version-independent element lookup
        # (?linked_document_id=&linked_element_global_id=). Partial so only
        # element-linked findings are indexed. Mirrors ix_attachments_linked_element.
        Index(
            "ix_findings_linked_element",
            "linked_document_id",
            "linked_element_global_id",
            postgresql_where=(
                "linked_document_id IS NOT NULL AND linked_element_global_id IS NOT NULL"
            ),
        ),
        # Offline-replay dedup: at most one finding per (creator, idempotency
        # key). Scoped to the creator so a leaked key can't replay another
        # member's write; partial so online (key-less) creates are exempt.
        Index(
            "uq_findings_creator_idempotency_key",
            "created_by_user_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )
