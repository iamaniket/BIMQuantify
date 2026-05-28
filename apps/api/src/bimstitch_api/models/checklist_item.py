from enum import StrEnum
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.borgingsmoment import Borgingsmoment
    from bimstitch_api.models.project import Project


class ChecklistItemType(StrEnum):
    # Polymorphic discriminator. MVP populates only `text`. The other types
    # are reserved for the Stage-2 mobile-inspection slice (#19+) where each
    # type carries a typed required-evidence affordance.
    text = "text"
    document = "document"
    photo = "photo"
    ifc_element = "ifc_element"


class EvidenceType(StrEnum):
    # What kind of evidence the inspector must capture to mark this item
    # pass/fail at #19+ inspection time.
    photo = "photo"
    certificate = "certificate"
    measurement = "measurement"
    document = "document"
    signature = "signature"


class ChecklistItem(TimestampMixin, TenantBase):
    __tablename__ = "checklist_items"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    borgingsmoment_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borgingsmomenten.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Denormalized for RLS single-column scoping (see borgingsmomenten).
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_type: Mapped[ChecklistItemType] = mapped_column(
        SAEnum(
            ChecklistItemType,
            name="checklistitemtype",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=ChecklistItemType.text,
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_type: Mapped[EvidenceType] = mapped_column(
        SAEnum(
            EvidenceType,
            name="evidencetype",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    bbl_article_ref: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pass_fail_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    # Stage-2 link points; nullable in MVP.
    linked_element_global_id: Mapped[str | None] = mapped_column(String(22), nullable=True)
    linked_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="SET NULL"),
        nullable=True,
    )
    extra_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    moment: Mapped["Borgingsmoment"] = relationship(back_populates="checklist_items")
    project: Mapped["Project"] = relationship()

    __table_args__ = (
        Index("ix_checklist_items_moment_id", "borgingsmoment_id"),
        Index("ix_checklist_items_project_id", "project_id"),
        Index("ix_checklist_items_moment_sequence", "borgingsmoment_id", "sequence"),
        Index(
            "ix_checklist_items_element_link",
            "linked_file_id",
            "linked_element_global_id",
            postgresql_where=text("linked_element_global_id IS NOT NULL"),
        ),
    )
