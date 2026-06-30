"""Pooled free-tier finding→attachment links — `public.pooled_finding_attachments`.

The free analog of `models.finding_attachment.FindingAttachment`: normalizes a
free snag's photo / resolution-evidence / reference lists into rows with a real
FK (never a JSONB array, per the CLAUDE.md enum/JSONB-evolution rules). `kind`
discriminates which list a link belongs to; `position` preserves order.

`owner_user_id` and `pooled_document_id` are denormalized off the parent finding so
the owner-OR-member RLS policy keys on this row directly — owner via the column,
members via `pooled_document_project(pooled_document_id)` — without a recursive join
back through the `pooled_findings` policy (see
`_rls_sql.enable_pooled_attachment_rls_statements`).
"""

from typing import TYPE_CHECKING
from uuid import UUID

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

from bimdossier_api.db import MasterBase
from bimdossier_api.models._pooled import PooledOwnedMixin

if TYPE_CHECKING:
    from bimdossier_api.models.free_finding import PooledFinding

# Same value set as the paid FINDING_ATTACHMENT_KINDS. String + CHECK (never an
# enum — the set can grow). photo = captured while logging; resolution_evidence =
# proof on resolve; reference = supporting docs.
POOLED_FINDING_ATTACHMENT_KINDS: tuple[str, ...] = (
    "photo",
    "resolution_evidence",
    "reference",
)


class PooledFindingAttachment(PooledOwnedMixin, MasterBase):
    __tablename__ = "pooled_finding_attachments"

    pooled_finding_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.pooled_findings.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Hard-deleting the attachment drops the link (the integrity a JSONB array
    # lacked). Attachments are usually soft-deleted, so reads filter deleted_at.
    pooled_attachment_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.pooled_attachments.id", ondelete="CASCADE"),
        nullable=False,
    )
    # `owner_user_id` (from PooledOwnedMixin) + `pooled_document_id` are denormalized
    # off the parent finding for the owner-OR-member RLS policy (no recursive join).
    pooled_document_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.pooled_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    finding: Mapped["PooledFinding"] = relationship(back_populates="attachment_links")

    __table_args__ = (
        CheckConstraint(
            "kind IN ('photo','resolution_evidence','reference')",
            name="ck_pooled_finding_attachments_kind",
        ),
        UniqueConstraint(
            "pooled_finding_id",
            "pooled_attachment_id",
            "kind",
            name="uq_free_finding_attachment",
        ),
        Index("ix_pooled_finding_attachments_finding", "pooled_finding_id"),
        Index("ix_pooled_finding_attachments_attachment", "pooled_attachment_id"),
        Index("ix_pooled_finding_attachments_owner", "owner_user_id"),
        {"schema": "public"},
    )
