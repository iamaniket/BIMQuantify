"""Pooled free-tier projects — `public.free_projects`.

The free wedge keeps free users as POOLED rows in `public`, never their own
`org_<hex>` tenant schema. A free "project" is therefore NOT a tenant
`models.project.Project` (which lives in `org_<hex>.projects`); it is a pooled
row here, isolated by owner-keyed RLS (`app.current_user_id` GUC set by
`get_free_session`), exactly like `free_models`/`free_snags`.

Columns deliberately mirror the paid `Project` (minus tenant-only concepts) so
the row serializes to the SAME `Project` API shape — the portal renders free
projects through the identical paid components. The portal's create wizard is
reused verbatim, so the full address/phase/building-type set is stored here.

Enum-valued columns are `String` + `CHECK` (the "likely-to-grow → String+CHECK"
convention) with the value sets derived from the paid enums so the two stay in
lockstep without a Postgres enum (and without the per-schema enum tax — though
pooled-in-`public` it would not fan out, the convention still applies).
"""

from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase
from bimdossier_api.models.project import (
    BuildingType,
    ProjectLifecycleState,
    ProjectPhase,
)

# Value sets derived from the paid enums — keeps the free CHECK constraints and
# the paid enum definitions in lockstep (no duplicated literals).
FREE_PROJECT_PHASES: tuple[str, ...] = tuple(p.value for p in ProjectPhase)
FREE_PROJECT_LIFECYCLE_STATES: tuple[str, ...] = tuple(s.value for s in ProjectLifecycleState)
FREE_PROJECT_BUILDING_TYPES: tuple[str, ...] = tuple(b.value for b in BuildingType)


def _in_clause(column: str, values: tuple[str, ...]) -> str:
    rendered = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({rendered})"


class FreeProject(MasterBase):
    __tablename__ = "free_projects"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    # Denormalized owner — the RLS policy keys on this column directly (no join).
    owner_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    # Construction project metadata (mirrors models.project.Project).
    reference_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    country: Mapped[str] = mapped_column(
        String(2), nullable=False, default="NL", server_default="NL"
    )
    lifecycle_state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", server_default="active"
    )
    phase: Mapped[str] = mapped_column(
        String(16), nullable=False, default="design", server_default="design"
    )
    delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    building_type: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Site address (BAG-aligned).
    street: Mapped[str | None] = mapped_column(String(255), nullable=True)
    house_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(7), nullable=True)
    city: Mapped[str | None] = mapped_column(String(255), nullable=True)
    municipality: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bag_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    permit_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # WGS84 (EPSG:4326) site coordinates (PDOK aerial thumbnail).
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            _in_clause("lifecycle_state", FREE_PROJECT_LIFECYCLE_STATES),
            name="ck_free_projects_lifecycle_state",
        ),
        CheckConstraint(_in_clause("phase", FREE_PROJECT_PHASES), name="ck_free_projects_phase"),
        CheckConstraint(
            f"building_type IS NULL OR {_in_clause('building_type', FREE_PROJECT_BUILDING_TYPES)}",
            name="ck_free_projects_building_type",
        ),
        Index("ix_free_projects_owner", "owner_user_id"),
        Index("ix_free_projects_owner_lifecycle", "owner_user_id", "lifecycle_state"),
        {"schema": "public"},
    )
