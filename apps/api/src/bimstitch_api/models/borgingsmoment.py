from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.borgingsplan import Borgingsplan
    from bimstitch_api.models.checklist_item import ChecklistItem
    from bimstitch_api.models.project import Project
    from bimstitch_api.models.user import User


class BorgingsmomentPhase(StrEnum):
    # Neutral construction phase codes. Country-specific labels (NL:
    # Fundering/Ruwbouw/Dak/Afbouw/Oplevering/Overig) live in the
    # jurisdiction registry.
    foundation = "foundation"
    shell = "shell"
    roof = "roof"
    finishing = "finishing"
    handover = "handover"
    other = "other"


class BorgingsmomentStatus(StrEnum):
    # Inspection event lifecycle. `passed`/`failed`/`skipped` are terminal;
    # `skipped` requires a reason note (enforced by router validation, not
    # the schema).
    planned = "planned"
    in_progress = "in_progress"
    passed = "passed"
    failed = "failed"
    skipped = "skipped"


class Borgingsmoment(TimestampMixin, TenantBase):
    __tablename__ = "borgingsmomenten"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    borgingsplan_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borgingsplans.id", ondelete="CASCADE"),
        nullable=False,
    )
    # project_id is denormalized so RLS policies can scope on a single column
    # without joining through borgingsplans.
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    phase: Mapped[BorgingsmomentPhase] = mapped_column(
        SAEnum(
            BorgingsmomentPhase,
            name="borgingsmomentphase",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    planned_date: Mapped[date] = mapped_column(Date, nullable=False)
    actual_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    responsible_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[BorgingsmomentStatus] = mapped_column(
        SAEnum(
            BorgingsmomentStatus,
            name="borgingsmomentstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=BorgingsmomentStatus.planned,
    )
    sequence_in_phase: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    plan: Mapped["Borgingsplan"] = relationship(back_populates="moments")
    project: Mapped["Project"] = relationship()
    responsible: Mapped["User | None"] = relationship(foreign_keys=[responsible_user_id])
    checklist_items: Mapped[list["ChecklistItem"]] = relationship(
        "ChecklistItem",
        back_populates="moment",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ChecklistItem.sequence",
    )

    __table_args__ = (
        Index("ix_borgingsmomenten_plan_id", "borgingsplan_id"),
        Index("ix_borgingsmomenten_project_id", "project_id"),
        Index(
            "ix_borgingsmomenten_plan_phase_seq",
            "borgingsplan_id",
            "phase",
            "sequence_in_phase",
        ),
    )
