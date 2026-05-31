from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import TimestampMixin
from bimstitch_api.models.user import User

if TYPE_CHECKING:
    from bimstitch_api.models.borgingsmoment import Borgingsmoment
    from bimstitch_api.models.checklist_item import ChecklistItem
    from bimstitch_api.models.project import Project


class InspectionVerdict(StrEnum):
    pass_verdict = "pass"
    fail = "fail"
    not_applicable = "not_applicable"


class ChecklistItemResult(TimestampMixin, TenantBase):
    __tablename__ = "checklist_item_results"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    checklist_item_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("checklist_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    borgingsmoment_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borgingsmomenten.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    verdict: Mapped[InspectionVerdict] = mapped_column(
        SAEnum(
            InspectionVerdict,
            name="inspectionverdict",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    inspector_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    inspected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="now()", nullable=False,
    )
    photo_ids: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)
    reference_attachment_ids: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)
    voice_note_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)

    checklist_item: Mapped["ChecklistItem"] = relationship()
    moment: Mapped["Borgingsmoment"] = relationship()
    project: Mapped["Project"] = relationship()
    inspector: Mapped[User] = relationship(User, foreign_keys=[inspector_user_id])

    __table_args__ = (
        UniqueConstraint("checklist_item_id", name="uq_checklist_item_results_item"),
        Index("ix_checklist_item_results_moment_id", "borgingsmoment_id"),
        Index("ix_checklist_item_results_project_id", "project_id"),
    )
