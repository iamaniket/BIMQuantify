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

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimdossier_api.models.checklist_item_result import ChecklistItemResult

# kind is String + CHECK (never a Postgres enum). Inspection results carry only
# photos and reference docs (no resolution evidence — that is a finding concept).
CHECKLIST_RESULT_ATTACHMENT_KINDS: tuple[str, ...] = ("photo", "reference")


class ChecklistItemResultAttachment(TimestampMixin, TenantBase):
    """A link from a checklist-item result to one attachment (``project_files``).

    Normalizes the former ``photo_ids`` / ``reference_attachment_ids`` JSONB
    arrays into rows with a real FK; ``kind`` discriminates the list and
    ``position`` preserves order.
    """

    __tablename__ = "checklist_item_result_attachments"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    result_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("checklist_item_results.id", ondelete="CASCADE"),
        nullable=False,
    )
    attachment_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    result: Mapped[ChecklistItemResult] = relationship(back_populates="attachment_links")

    __table_args__ = (
        CheckConstraint(
            "kind IN ('photo','reference')",
            name="ck_checklist_item_result_attachments_kind",
        ),
        UniqueConstraint(
            "result_id", "attachment_id", "kind", name="uq_checklist_item_result_attachment"
        ),
        Index("ix_cir_attachments_result", "result_id"),
        Index("ix_cir_attachments_attachment", "attachment_id"),
    )
