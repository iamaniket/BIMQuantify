"""Pooled free-tier snags — `public.free_findings`.

A minimal snag on a free document (container): title/note/severity/status plus an
anchor (world-space `anchor_x/y/z` for IFC, or `anchor_page` for a paged file) and
the IFC `linked_element_global_id`. `owner_user_id` is denormalized off the parent
document so the RLS policy keys on this row directly without a join to
`free_documents` (see `_rls_sql.enable_free_member_rls_statements`).

The snag anchors to the version-independent `free_document_id` (mirrors paid
`Finding.linked_document_id`); `linked_file_id` optionally pins the version it was
filed against (mirrors paid `Finding.linked_file_id`).

At conversion these map to real `findings`: severity/status translate to the
`FindingSeverity`/`FindingStatus` enums, and the world-space anchor + GlobalId
carry over directly (both are stable across re-extraction). See
`free_document.FreeDocument` for the pooling rationale.
"""

from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import MasterBase

if TYPE_CHECKING:
    from bimdossier_api.models.free_finding_attachment import FreeFindingAttachment

# Neutral severity/status codes — kept value-compatible with FindingSeverity so
# conversion is a direct map. Imported by the router/schemas to keep CHECK and
# API validation aligned.
FREE_FINDING_SEVERITIES: tuple[str, ...] = ("low", "medium", "high")
# Value-identical to FindingStatus (models.finding) so the board UI is reused
# unchanged and conversion maps 1:1.
FREE_FINDING_STATUSES: tuple[str, ...] = (
    "draft",
    "open",
    "in_progress",
    "resolved",
    "verified",
)
FREE_FINDING_NOTE_MAX = 4000


def _in_clause(column: str, values: tuple[str, ...]) -> str:
    rendered = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({rendered})"


class FreeFinding(MasterBase):
    __tablename__ = "free_findings"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    # Version-independent identity = the container (mirrors Finding.linked_document_id).
    free_document_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The specific version the snag was filed against (mirrors Finding.linked_file_id).
    # SET NULL so deleting a version doesn't destroy its snags. NULL = unpinned.
    linked_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_project_files.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Denormalized so the RLS policy needs no join to free_documents. Stays = the
    # project OWNER even when a member files the snag, so the owner-keyed quota /
    # RLS branch and conversion (snag.owner_user_id → finding.created_by) hold.
    owner_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Attribution: who actually filed the snag (a member may differ from the
    # owner). NULL for owner-authored / pre-collaboration rows.
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Assignment: the project participant (owner or invited member) responsible for
    # the snag. NULL = unassigned. Mirrors paid Finding.assignee_user_id; validated
    # at write time against the project's participants (see free_access). SET NULL so
    # removing a member doesn't destroy their snags' assignment integrity.
    assigned_to_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Optional due date (calendar date, not a timestamp) — mirrors paid
    # Finding.deadline_date so the board card + conversion carry it over directly.
    deadline_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(
        String(8), nullable=False, default="medium", server_default="medium"
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="open", server_default="open"
    )

    linked_file_type: Mapped[str] = mapped_column(
        String(8), nullable=False, default="ifc", server_default="ifc"
    )
    anchor_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_z: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    linked_element_global_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Photo / resolution-evidence / reference links (mirrors paid
    # Finding.attachment_links). selectin so a list/get query that eager-loads it
    # exposes photo_ids without a per-row lazy load; create/update build the links
    # through this collection so the in-memory read needs no DB round-trip.
    attachment_links: Mapped[list["FreeFindingAttachment"]] = relationship(
        back_populates="finding",
        cascade="all, delete-orphan",
        order_by="FreeFindingAttachment.position",
        lazy="selectin",
    )

    def _ids_for_kind(self, kind: str) -> list[UUID] | None:
        ids = [link.free_attachment_id for link in self.attachment_links if link.kind == kind]
        return ids or None

    @property
    def photo_ids(self) -> list[UUID] | None:
        return self._ids_for_kind("photo")

    @property
    def resolution_evidence_ids(self) -> list[UUID] | None:
        return self._ids_for_kind("resolution_evidence")

    __table_args__ = (
        CheckConstraint(
            _in_clause("severity", FREE_FINDING_SEVERITIES), name="ck_free_findings_severity"
        ),
        CheckConstraint(
            _in_clause("status", FREE_FINDING_STATUSES), name="ck_free_findings_status"
        ),
        CheckConstraint(
            f"note IS NULL OR char_length(note) <= {FREE_FINDING_NOTE_MAX}",
            name="ck_free_findings_note_len",
        ),
        Index("ix_free_findings_document", "free_document_id"),
        Index("ix_free_findings_file", "linked_file_id"),
        Index("ix_free_findings_owner", "owner_user_id"),
        Index("ix_free_findings_assignee", "assigned_to_user_id"),
        {"schema": "public"},
    )
