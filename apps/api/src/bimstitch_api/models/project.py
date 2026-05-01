from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Date
from sqlalchemy import Enum as SAEnum
from sqlalchemy import Float, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import Base
from bimstitch_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.contractor import Contractor
    from bimstitch_api.models.model import Model
    from bimstitch_api.models.project_member import ProjectMember


class ProjectStatus(StrEnum):
    planning = "planning"
    ontwerp = "ontwerp"
    vergunning = "vergunning"
    uitvoering = "uitvoering"
    oplevering = "oplevering"
    gereed = "gereed"
    on_hold = "on_hold"


class ProjectLifecycleState(StrEnum):
    active = "active"
    archived = "archived"
    removed = "removed"


class ProjectPhase(StrEnum):
    ontwerp = "ontwerp"
    bestek = "bestek"
    werkvoorbereiding = "werkvoorbereiding"
    ruwbouw = "ruwbouw"
    afbouw = "afbouw"
    oplevering = "oplevering"


class Project(TimestampMixin, Base):
    __tablename__ = "projects"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    owner_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Construction project metadata.
    reference_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[ProjectStatus] = mapped_column(
        SAEnum(
            ProjectStatus,
            name="projectstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=ProjectStatus.planning,
        server_default=ProjectStatus.planning.value,
    )
    lifecycle_state: Mapped[ProjectLifecycleState] = mapped_column(
        SAEnum(
            ProjectLifecycleState,
            name="projectlifecyclestate",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=ProjectLifecycleState.active,
        server_default=ProjectLifecycleState.active.value,
    )
    phase: Mapped[ProjectPhase] = mapped_column(
        SAEnum(
            ProjectPhase,
            name="projectphase",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=ProjectPhase.ontwerp,
        server_default=ProjectPhase.ontwerp.value,
    )
    delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Site address (BAG-aligned for future Dutch address-service integration).
    street: Mapped[str | None] = mapped_column(String(255), nullable=True)
    house_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(7), nullable=True)
    city: Mapped[str | None] = mapped_column(String(255), nullable=True)
    municipality: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bag_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    permit_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # WGS84 (EPSG:4326) site coordinates. Populated from PDOK Locatieserver
    # lookup so the portal can render a free PDOK aerial thumbnail without
    # needing a user-uploaded image.
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)

    contractor_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("contractors.id", ondelete="SET NULL"),
        nullable=True,
    )

    members: Mapped[list["ProjectMember"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    models: Mapped[list["Model"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    contractor: Mapped["Contractor | None"] = relationship(lazy="joined")

    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_projects_org_name"),
        Index("ix_projects_organization_id", "organization_id"),
        Index("ix_projects_status", "status"),
        Index("ix_projects_lifecycle_state", "lifecycle_state"),
        Index("ix_projects_contractor_id", "contractor_id"),
        Index(
            "uq_projects_org_reference_code",
            "organization_id",
            "reference_code",
            unique=True,
            postgresql_where="reference_code IS NOT NULL",
        ),
    )
