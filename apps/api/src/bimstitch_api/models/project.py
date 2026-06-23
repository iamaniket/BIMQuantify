from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Date, Float, ForeignKey, Index, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.model import Model
    from bimstitch_api.models.project_member import ProjectMember


class ProjectLifecycleState(StrEnum):
    active = "active"
    archived = "archived"
    removed = "removed"
    # TODO(tier-2-archive): Add 'restoring' transitional state for the async
    # Glacier restore flow (active → archived → restoring → active).


class ProjectPhase(StrEnum):
    design = "design"
    tender = "tender"
    work_prep = "work_prep"
    shell = "shell"
    finishing = "finishing"
    handover = "handover"


class BuildingType(StrEnum):
    # Neutral building-type codes aligned with the Dutch Bbl "gebruiksfuncties"
    # (building-code use functions). Localized labels live in the jurisdiction
    # registry (e.g. NL: 'dwelling' -> 'Woning'), keeping codes language-neutral
    # so other jurisdictions render their own labels for the same codes.
    dwelling = "dwelling"  # woonfunctie
    assembly = "assembly"  # bijeenkomstfunctie
    cell = "cell"  # celfunctie
    healthcare = "healthcare"  # gezondheidszorgfunctie
    industrial = "industrial"  # industriefunctie
    office = "office"  # kantoorfunctie
    accommodation = "accommodation"  # logiesfunctie
    education = "education"  # onderwijsfunctie
    sport = "sport"  # sportfunctie
    retail = "retail"  # winkelfunctie
    non_building = "non_building"  # bouwwerk geen gebouw zijnde
    other = "other"  # overige gebruiksfunctie / catch-all (dossier fallback)
    # Legacy: superseded by the gebruiksfunctie codes above (kept valid for
    # existing rows; not offered in the project wizard).
    commercial = "commercial"


class Project(TimestampMixin, TenantBase):
    """Project — lives in `org_<hex>.projects`. No `organization_id` column
    because the schema name IS the organization. FK to `users` is qualified
    as `public.users` (master schema)."""

    __tablename__ = "projects"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    owner_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Construction project metadata.
    reference_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    country: Mapped[str] = mapped_column(
        String(2), nullable=False, default="NL", server_default="NL"
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
        default=ProjectPhase.design,
        server_default=ProjectPhase.design.value,
    )
    delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Building classification. Neutral codes; Dutch/German/etc labels are
    # provided by the jurisdiction registry so the portal renders the right
    # language for the project's country.
    building_type: Mapped[BuildingType | None] = mapped_column(
        SAEnum(
            BuildingType,
            name="buildingtype",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=True,
    )

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

    members: Mapped[list["ProjectMember"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    models: Mapped[list["Model"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index(
            "uq_projects_name_active",
            "name",
            unique=True,
            postgresql_where="lifecycle_state != 'removed'",
        ),
        Index("ix_projects_lifecycle_state", "lifecycle_state"),
        Index("ix_projects_planned_start_date", "planned_start_date"),
        Index(
            "uq_projects_reference_code",
            "reference_code",
            unique=True,
            postgresql_where="reference_code IS NOT NULL AND lifecycle_state != 'removed'",
        ),
        Index("ix_projects_owner_id", "owner_id"),
        Index(
            "ix_projects_lifecycle_active",
            "lifecycle_state",
            postgresql_where="lifecycle_state IN ('active', 'archived')",
        ),
    )
