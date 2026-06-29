"""Pooled free-tier levels — `public.free_levels`.

The pooled analog of `models.levels.Level`: a project-owned building level (the
shared 2D/3D spine). It lets a free user group PDF drawings by floor and switch
levels in the unified viewer. A free PDF container is assigned to a level via
`free_documents.level_id`.

Pooled-in-`public`, never a tenant `org_<hex>` schema — isolation is owner-keyed
RLS on `owner_user_id` plus owner-OR-member visibility through the project (see
`_rls_sql.enable_free_level_rls_statements`). Columns mirror the paid `Level` so
the paid `LevelRead` schema serializes a free row unchanged; `source` is a
`String` + `CHECK` (the "likely-to-grow → String+CHECK" convention), value set
derived from the paid `LevelSource`.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase
from bimdossier_api.models.levels import LevelSource

# Value set derived from the paid LevelSource — keeps the free CHECK and the paid
# constant in lockstep. Free levels are manual today; `ifc` reserved for a future
# storey→level reconciliation at free extraction time.
FREE_LEVEL_SOURCES: tuple[str, ...] = (LevelSource.manual, LevelSource.ifc)


class FreeLevel(MasterBase):
    __tablename__ = "free_levels"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    # Denormalized owner — the RLS policy keys on this column directly (no join).
    owner_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    free_project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_projects.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    elevation_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    ordering: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default="manual", server_default="manual"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    __table_args__ = (
        CheckConstraint("source IN ('manual', 'ifc')", name="ck_free_levels_source"),
        # One active level per (project, name) — partial so a soft-deleted name reuses.
        Index(
            "uq_free_levels_project_name",
            "free_project_id",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_free_levels_owner", "owner_user_id"),
        Index("ix_free_levels_project", "free_project_id"),
        {"schema": "public"},
    )
