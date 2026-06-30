"""Pooled free-tier aligned sheets — `public.free_aligned_sheets`.

The pooled analog of `models.aligned_sheets.AlignedSheet`: a PDF↔IFC calibration
that pins a free PDF drawing page to a free building level's 3D slice via a solved
2D similarity transform. Lets a free user overlay a PDF on the model in the unified
viewer (the same `solve_similarity` math the paid tier uses).

Differs from the paid `AlignedSheet`: the PDF page is referenced by **`page_number`
(1-indexed int)** rather than a `pdf_pages` FK (free has no pooled pdf_pages table —
free findings/sheets reference pages by number). Pooled-in-`public`, owner-keyed
RLS + owner-OR-member through the project (see `_rls_sql`).
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase
from bimdossier_api.models._pooled import PooledOwnedMixin, TimestampMixin

TRANSFORM_TYPE_SIMILARITY = "similarity_2d"


class FreeAlignedSheet(PooledOwnedMixin, TimestampMixin, MasterBase):
    __tablename__ = "free_aligned_sheets"

    # Carried for the owner-OR-member RLS policy (free_is_member(free_project_id)).
    free_project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The 3D (IFC) container supplying world coords.
    free_document_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    free_level_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_levels.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The PDF container whose page is aligned.
    free_pdf_document_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    # 1-indexed PDF page (free has no pdf_pages table — referenced by number).
    page_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # The exact PDF version the control points were picked on (drift detection).
    calibrated_pdf_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.free_project_files.id", ondelete="SET NULL"),
        nullable=True,
    )

    transform_type: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=TRANSFORM_TYPE_SIMILARITY,
        server_default=TRANSFORM_TYPE_SIMILARITY,
    )
    # Solved similarity (PDF plan space → document plan space); NULL until calibrated.
    scale: Mapped[float | None] = mapped_column(Float, nullable=True)
    rotation_rad: Mapped[float | None] = mapped_column(Float, nullable=True)
    offset_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    offset_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Raw picks {"pdf": [[u1,v1],[u2,v2]], "plan": [[x1,y1],[x2,y2]]} — audit + re-solve.
    control_points: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    @property
    def is_calibrated(self) -> bool:
        return self.scale is not None

    __table_args__ = (
        CheckConstraint(
            "transform_type IN ('similarity_2d')",
            name="ck_free_aligned_sheets_transform_type",
        ),
        CheckConstraint("page_number >= 1", name="ck_free_aligned_sheets_page_number"),
        # One active sheet per (level, page) — partial so soft-deleted rows are exempt.
        Index(
            "uq_free_aligned_sheets_level_page",
            "free_level_id",
            "page_number",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_free_aligned_sheets_owner", "owner_user_id"),
        Index("ix_free_aligned_sheets_project", "free_project_id"),
        Index("ix_free_aligned_sheets_level", "free_level_id"),
        {"schema": "public"},
    )
