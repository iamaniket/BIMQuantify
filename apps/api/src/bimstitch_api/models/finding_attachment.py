from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.finding import Finding

# kind is String + CHECK (never a Postgres enum, per the CLAUDE.md enum-evolution
# rule) — the value set can grow. photo = captured while logging; reference =
# supporting docs; resolution_evidence = proof required on resolve (#26/#27).
FINDING_ATTACHMENT_KINDS: tuple[str, ...] = ("photo", "resolution_evidence", "reference")


class FindingAttachment(TimestampMixin, TenantBase):
    """A link from a finding to one attachment (a ``project_files`` row).

    Normalizes the former ``photo_ids`` / ``resolution_evidence_ids`` /
    ``reference_attachment_ids`` JSONB arrays into rows with a real FK. ``kind``
    discriminates which list the link belongs to; ``position`` preserves the
    original array order.
    """

    __tablename__ = "finding_attachments"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    finding_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("findings.id", ondelete="CASCADE"),
        nullable=False,
    )
    # FK to the attachment row. ON DELETE CASCADE: hard-deleting the attachment
    # drops the link (the integrity the JSONB array lacked). Attachments are
    # usually soft-deleted, so reads still filter deleted_at downstream.
    attachment_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    finding: Mapped[Finding] = relationship(back_populates="attachment_links")

    __table_args__ = (
        CheckConstraint(
            "kind IN ('photo','resolution_evidence','reference')",
            name="ck_finding_attachments_kind",
        ),
        UniqueConstraint(
            "finding_id", "attachment_id", "kind", name="uq_finding_attachment"
        ),
        Index("ix_finding_attachments_finding", "finding_id"),
        Index("ix_finding_attachments_attachment", "attachment_id"),
    )
