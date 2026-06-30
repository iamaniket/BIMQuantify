"""Pooled free-tier documents — `public.free_documents`.

The free wedge mirrors the paid **Document ("Container") → ProjectFile** stack so
the portal renders free models through the identical paid components and the
free→paid conversion is a near 1:1 row copy. A `FreeDocument` is the pooled
analog of `models.document.Document`: a named container that holds one or more
versioned `FreeProjectFile` rows (see `free_project_file.FreeProjectFile`).

Pooled-in-`public`, never a tenant `org_<hex>` schema — isolation is owner-keyed
RLS on `owner_user_id` (the `app.current_user_id` GUC set by `get_free_session`)
plus owner-OR-member visibility through the project (see
`_rls_sql.enable_free_member_rls_statements`). IFC-only.

Differences from the paid `Document`:
- Pooled columns `owner_user_id` (RLS key) + `free_project_id` instead of a
  tenant `project_id`. Every free container belongs to a free project (NOT NULL,
  CASCADE) — exact paid parity, no ungrouped state.
- Enum-valued columns are `String` + `CHECK` (the "likely-to-grow → String+CHECK"
  convention), value sets derived from the paid enums to stay in lockstep.
  `primary_file_type` is constrained to `ifc` (free is IFC-only).
- No `level_id` / `storeys` (free has no 2D-drawing levels).
- `last_viewed_at` lives here (the container is the unit the viewer opens and the
  idle reaper sweeps).
- `head_file_id` is the F7 current-version pointer — a plain column with NO ORM
  relationship and `use_alter=True` to break the free_documents↔free_project_files
  mutual-FK cycle (same cycle-breaker as `document.Document.head_file_id`).
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase
from bimdossier_api.models._pooled import PooledOwnedMixin, TimestampMixin, check_in
from bimdossier_api.models.document import DocumentDiscipline, DocumentStatus
from bimdossier_api.models.project_file import FileType

# Value sets derived from the paid enums — keeps the free CHECK constraints and
# the paid enum definitions in lockstep (no duplicated literals). `primary_file_type`
# is IFC + PDF for the free tier (3D models and 2D drawings; viewer parity).
FREE_DOC_DISCIPLINES: tuple[str, ...] = tuple(d.value for d in DocumentDiscipline)
FREE_DOC_STATUSES: tuple[str, ...] = tuple(s.value for s in DocumentStatus)
FREE_DOC_FILE_TYPES: tuple[str, ...] = (FileType.ifc.value, FileType.pdf.value)


class FreeDocument(PooledOwnedMixin, TimestampMixin, MasterBase):
    __tablename__ = "free_documents"

    # Every free container belongs to a free project (paid parity). CASCADE so
    # deleting a project removes its containers — mirrors paid
    # `Document.project_id` (ondelete CASCADE).
    free_project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_projects.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    discipline: Mapped[str] = mapped_column(
        String(16), nullable=False, default="other", server_default="other"
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", server_default="active"
    )
    # NULL until the first file is uploaded, then locked to that type (ifc or pdf).
    primary_file_type: Mapped[str | None] = mapped_column(String(8), nullable=True)

    # The building level a 2D (PDF) drawing belongs to (mirrors paid
    # Document.level_id). NULL = Unassigned; SET NULL so deleting a level reverts
    # its drawings to Unassigned. IFC containers leave this NULL.
    level_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_levels.id", ondelete="SET NULL"),
        nullable=True,
    )

    # F7 current-revision pointer. NULL = head is derived as the highest
    # version_number. Plain column, NO ORM relationship; `use_alter` emits the FK
    # as a separate ALTER so create_all / drop_all can order the two tables in the
    # free_documents↔free_project_files cycle. Resolution reuses the paid
    # `routers/project_files/_shared.resolve_head_file_id`.
    head_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey(
            "public.free_project_files.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_free_documents_head_file_id",
        ),
        nullable=True,
    )

    # Stamped by the viewer-bundle GET; drives the idle reaper (the container is
    # the unit opened + swept).
    last_viewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    __table_args__ = (
        CheckConstraint(
            check_in("discipline", FREE_DOC_DISCIPLINES),
            name="ck_free_documents_discipline",
        ),
        CheckConstraint(
            check_in("status", FREE_DOC_STATUSES),
            name="ck_free_documents_status",
        ),
        CheckConstraint(
            f"primary_file_type IS NULL OR {check_in('primary_file_type', FREE_DOC_FILE_TYPES)}",
            name="ck_free_documents_primary_file_type",
        ),
        # Unique container name per project (mirrors paid uq_documents_project_name).
        # Partial so a soft-deleted container's name can be reused.
        Index(
            "uq_free_documents_project_name",
            "free_project_id",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_free_documents_owner", "owner_user_id"),
        Index("ix_free_documents_owner_status", "owner_user_id", "status"),
        Index("ix_free_documents_free_project", "free_project_id"),
        {"schema": "public"},
    )
