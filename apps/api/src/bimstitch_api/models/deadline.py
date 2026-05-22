from datetime import date, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import Date, DateTime, Enum as SAEnum, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import TimestampMixin

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bimstitch_api.models.project import Project
    from bimstitch_api.models.user import User


class DeadlineStatus(StrEnum):
    pending = "pending"
    met = "met"
    not_applicable = "not_applicable"


class Deadline(TimestampMixin, TenantBase):
    """A formal notification deadline for a project.

    NL Wkb requires three meldingen per project (bouwmelding,
    informatieplicht, gereedmelding). Other jurisdictions register their
    own deadline types via the jurisdiction registry — `deadline_type` is
    `String(50)` not a Postgres ENUM so adding DE is data, not schema.

    System-managed: rows are upserted by `recompute_deadlines()` on
    project create / date-field update. Users cannot create or delete
    deadlines directly — only mark them as `met`.
    """

    __tablename__ = "deadlines"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    deadline_type: Mapped[str] = mapped_column(String(50), nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[DeadlineStatus] = mapped_column(
        SAEnum(
            DeadlineStatus,
            name="deadlinestatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=DeadlineStatus.pending,
    )
    met_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    met_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    project: Mapped["Project"] = relationship()
    met_by_user: Mapped["User | None"] = relationship(foreign_keys=[met_by_user_id])

    __table_args__ = (
        UniqueConstraint("project_id", "deadline_type", name="uq_deadline_project_type"),
        Index("ix_deadlines_project_id", "project_id"),
        Index("ix_deadlines_due_date", "due_date"),
        Index("ix_deadlines_status", "status"),
    )
