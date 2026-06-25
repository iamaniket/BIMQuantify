"""A building level — the project-owned spine shared by 2D drawings and 3D models.

A ``Level`` belongs to a ``Project`` (not a ``Document``), so it exists for
2D-only projects (no IFC) and for federated 3D projects alike. It is the one
concept both worlds share:

* a 3D ``Storey`` (extracted per-discipline from each IFC) reconciles onto a
  shared project ``Level`` (``Storey.level_id``);
* a 2D drawing ``Document`` (PDF/DXF) *belongs to* a level (``Document.level_id``);
* an ``AlignedSheet`` calibrates a drawing to a level's 3D slice (``AlignedSheet.level_id``).

``source`` records whether the row was created by a user (``manual`` — typical
for 2D-only projects) or auto-created during IFC extraction reconciliation
(``ifc``). It is a ``String`` + CHECK, not a Postgres enum, per the
enum-evolution rule (a likely-to-grow, language-neutral category).
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimdossier_api.models.project import Project


class LevelSource:
    """Allowed values for ``Level.source`` (String + CHECK, not a PG enum)."""

    manual = "manual"
    ifc = "ifc"


class Level(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "levels"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Display name. For manual levels this is whatever the user typed; for
    # IFC-reconciled levels it is derived from the storey name (or an elevation
    # fallback). Single-language by design.
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Floor elevation in model units (meters, Y-up). Nullable: a pure-2D level
    # may have no known elevation.
    elevation_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Display sort key, ascending by elevation.
    ordering: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 'manual' (user-created) | 'ifc' (extraction-reconciled). String + CHECK.
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default=LevelSource.manual, server_default=LevelSource.manual
    )

    project: Mapped[Project] = relationship(back_populates="levels")

    __table_args__ = (
        # One active level per (project, name). Partial so soft-deleted rows are
        # exempt and a name can be reused.
        Index(
            "uq_levels_project_name",
            "project_id",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_levels_project_id", "project_id"),
        CheckConstraint("source IN ('manual', 'ifc')", name="ck_levels_source"),
    )
