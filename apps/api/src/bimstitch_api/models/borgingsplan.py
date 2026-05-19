from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import TimestampMixin
# `User` lives in MasterBase's registry; cross-registry relationships must
# pass the class directly (string lookup is per-registry).
from bimstitch_api.models.user import User

if TYPE_CHECKING:
    from bimstitch_api.models.borgingsmoment import Borgingsmoment
    from bimstitch_api.models.project import Project


class BorgingsplanStatus(StrEnum):
    # Lifecycle of a borgingsplan version. At any time a project has zero
    # or one row in `draft` or `published` (enforced by the partial unique
    # index `ux_borgingsplans_one_active`). Older versions are kept as
    # `superseded` rows for the legal audit trail.
    draft = "draft"
    published = "published"
    superseded = "superseded"


class Borgingsplan(TimestampMixin, TenantBase):
    __tablename__ = "borgingsplans"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[BorgingsplanStatus] = mapped_column(
        SAEnum(
            BorgingsplanStatus,
            name="borgingsplanstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=BorgingsplanStatus.draft,
    )
    created_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped["Project"] = relationship()
    created_by: Mapped[User] = relationship(User, foreign_keys=[created_by_user_id])
    moments: Mapped[list["Borgingsmoment"]] = relationship(
        "Borgingsmoment",
        back_populates="plan",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        UniqueConstraint("project_id", "version_number", name="uq_borgingsplans_project_version"),
        Index("ix_borgingsplans_project_id", "project_id"),
    )
