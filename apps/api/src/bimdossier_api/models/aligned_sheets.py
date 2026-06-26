"""A 2D PDF drawing page pinned to a project Level, calibrated against a 3D model.

The bridge between a project ``Level`` (the shared 2D/3D spine) and two
``Document`` rows: a 3D document (``document_id`` — supplies the world
coordinates to calibrate against) and a PDF document (``pdf_document_id`` — a
Document with ``primary_file_type='pdf'`` whose head version supplies the page
pixels). It stores the manually-calibrated 2-point *similarity* transform
(uniform scale + rotation + XY translation; see
``bimdossier_api.alignment.similarity``) that maps the PDF page's plan space onto
the model's plan space at the level elevation.

Created uncalibrated (transform columns NULL), then filled by the ``/calibrate``
endpoint once the user picks the control points. ``calibrated_pdf_file_id``
pins the exact PDF version the points were picked on, so a later version
reclaiming the document head can be flagged as drift.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimdossier_api.models.document import Document
    from bimdossier_api.models.levels import Level
    from bimdossier_api.models.pdf_pages import PdfPage
    from bimdossier_api.models.project import Project
    from bimdossier_api.models.user import User

# v1 transform model. Plain String + CHECK (not a Postgres enum) so adding
# 'affine_2d' later is a code-only change — no tenant fan-out migration
# (enum-evolution rule). The CHECK is the DB backstop; the app validates too.
TRANSFORM_TYPE_SIMILARITY = "similarity_2d"
ALLOWED_TRANSFORM_TYPES = (TRANSFORM_TYPE_SIMILARITY,)


class AlignedSheet(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "aligned_sheets"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The 3D document this sheet aligns to (supplies the world coordinates).
    document_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Which project Level (the shared 2D/3D spine) the sheet is pinned to.
    level_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("levels.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The PDF *document* (primary_file_type='pdf'); the viewer renders its head version.
    pdf_document_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The exact PDF ProjectFile version the control points were picked on, for
    # drift detection when a newer version reclaims the document head. SET NULL so
    # removing that version doesn't cascade-delete the alignment.
    calibrated_pdf_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="SET NULL"),
        nullable=True,
    )
    # The logical PDF page (document-owned, version-independent) this sheet
    # aligns. Replaces the former bare 0-indexed `page_index` int; the router
    # resolves a page_index (0-based) to this page via find-or-create. CASCADE
    # matches pdf_document_id — deleting the PDF document removes its pages and
    # this sheet.
    page_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("pdf_pages.id", ondelete="CASCADE"),
        nullable=False,
    )
    transform_type: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=TRANSFORM_TYPE_SIMILARITY,
        server_default=TRANSFORM_TYPE_SIMILARITY,
    )
    # Solved similarity transform (PDF plan space -> document plan space). NULL
    # until the sheet is calibrated.
    scale: Mapped[float | None] = mapped_column(Float, nullable=True)
    rotation_rad: Mapped[float | None] = mapped_column(Float, nullable=True)
    offset_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    offset_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Raw control-point picks, kept for audit + re-solve:
    #   {"pdf": [[u1, v1], [u2, v2]], "world": [[x1, y1, z1], [x2, y2, z2]]}
    # Fixed-shape but a self-contained spec consumed wholesale -> JSONB (the
    # standing Job.payload-style exception), not relational columns.
    control_points: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    project: Mapped[Project] = relationship()
    document: Mapped[Document] = relationship(foreign_keys=[document_id])
    pdf_document: Mapped[Document] = relationship(foreign_keys=[pdf_document_id])
    # selectin so the page_number/page_index read properties below resolve
    # without an async lazy-load when a sheet is serialized.
    page: Mapped[PdfPage] = relationship(lazy="selectin")
    level: Mapped[Level] = relationship()
    created_by: Mapped[User] = relationship(foreign_keys=[created_by_user_id], lazy="raise")

    @property
    def is_calibrated(self) -> bool:
        """True once the similarity transform has been solved and stored."""
        return self.scale is not None

    @property
    def page_number(self) -> int:
        """1-indexed page number, read off the logical PdfPage."""
        return self.page.page_number

    @property
    def page_index(self) -> int:
        """0-indexed page position (back-compat read field; = page_number - 1)."""
        return self.page.page_number - 1

    __table_args__ = (
        CheckConstraint(
            "transform_type IN ('similarity_2d')",
            name="ck_aligned_sheets_transform_type",
        ),
        Index("ix_aligned_sheets_project_id", "project_id"),
        Index("ix_aligned_sheets_document_id", "document_id"),
        Index("ix_aligned_sheets_level_id", "level_id"),
        Index("ix_aligned_sheets_page_id", "page_id"),
        # One active sheet per (level, page). The page_id encodes (pdf_document,
        # page_number), so this still allows multiple discipline drawings on one
        # floor (different pdf_document -> different pages) while blocking a
        # duplicate alignment of the same page. Partial so soft-deleted rows are
        # exempt.
        Index(
            "uq_aligned_sheets_level_page",
            "level_id",
            "page_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
