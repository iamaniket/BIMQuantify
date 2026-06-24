"""A 2D PDF drawing page pinned to a storey of a 3D model.

The bridge between two ``Model`` rows: a 3D model (``model_id`` — owns the
storeys and world coordinates) and a PDF model (``pdf_model_id`` — a Model with
``primary_file_type='pdf'`` whose head version supplies the page pixels). It
stores the manually-calibrated 2-point *similarity* transform (uniform scale +
rotation + XY translation; see ``bimstitch_api.alignment.similarity``) that maps
the PDF page's plan space onto the model's plan space at the storey elevation.

Created uncalibrated (transform columns NULL), then filled by the ``/calibrate``
endpoint once the user picks the control points. ``calibrated_pdf_file_id``
pins the exact PDF version the points were picked on, so a later version
reclaiming the model head can be flagged as drift.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.model import Model
    from bimstitch_api.models.project import Project
    from bimstitch_api.models.storeys import Storey
    from bimstitch_api.models.user import User

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
    # The 3D model this sheet aligns to (owns storeys + world coordinates).
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("models.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Which storey of the 3D model the sheet is pinned to.
    storey_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("storeys.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The PDF *model* (primary_file_type='pdf'); the viewer renders its head version.
    pdf_model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("models.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The exact PDF ProjectFile version the control points were picked on, for
    # drift detection when a newer version reclaims the model head. SET NULL so
    # removing that version doesn't cascade-delete the alignment.
    calibrated_pdf_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="SET NULL"),
        nullable=True,
    )
    # 0-indexed page of the PDF (note: Finding.anchor_page is 1-indexed — convert
    # at the API/viewer boundary).
    page_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    transform_type: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=TRANSFORM_TYPE_SIMILARITY,
        server_default=TRANSFORM_TYPE_SIMILARITY,
    )
    # Solved similarity transform (PDF plan space -> model plan space). NULL until
    # the sheet is calibrated.
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
    model: Mapped[Model] = relationship(foreign_keys=[model_id])
    pdf_model: Mapped[Model] = relationship(foreign_keys=[pdf_model_id])
    storey: Mapped[Storey] = relationship()
    created_by: Mapped[User] = relationship(foreign_keys=[created_by_user_id], lazy="raise")

    @property
    def is_calibrated(self) -> bool:
        """True once the similarity transform has been solved and stored."""
        return self.scale is not None

    __table_args__ = (
        CheckConstraint(
            "transform_type IN ('similarity_2d')",
            name="ck_aligned_sheets_transform_type",
        ),
        Index("ix_aligned_sheets_project_id", "project_id"),
        Index("ix_aligned_sheets_model_id", "model_id"),
        Index("ix_aligned_sheets_storey_id", "storey_id"),
        # One active sheet per (storey, PDF model, page). Allows multiple
        # discipline drawings on one floor (e.g. arch + MEP) while blocking a
        # duplicate alignment of the same page. Partial so soft-deleted rows are
        # exempt.
        Index(
            "uq_aligned_sheets_storey_pdf_page",
            "storey_id",
            "pdf_model_id",
            "page_index",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
