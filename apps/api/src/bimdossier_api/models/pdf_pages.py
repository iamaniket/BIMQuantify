"""A logical page of a PDF "drawing" Document.

A ``PdfPage`` is **document-owned** (FK ``pdf_document_id`` -> a ``Document``
with ``primary_file_type='pdf'``) and version-independent — it represents "sheet
N of this drawing, across every revision". It is the single, stable FK target
that both ``aligned_sheets`` (``page_id``) and ``findings`` (``anchor_page_id``)
pin to, replacing the bare ``page_index``/``anchor_page`` integers.

Why document-owned and not file-version-owned: PDF page identity does not
survive a re-upload (each version is an independent immutable ``ProjectFile``
with its own page order; there is no per-page GUID and no cross-version
mapping). The viewer renders the document HEAD, so a page that hangs off the
document stays valid as new versions reclaim the head;
``aligned_sheets.calibrated_pdf_file_id`` is the version pin that surfaces
drift. ``page_number`` is **1-indexed** (the human convention, matching
``Finding.anchor_page``); the 0-based positional index a PDF version exposes is
derived at the API/viewer boundary.

Pages are populated by ``jobs_internal._upsert_pdf_pages`` at PDF-extraction
success (find-or-create up to ``page_count``) and by the aligned-sheet / finding
routers on demand (find-or-create when the user pins a page). They are **never
soft-deleted** — the page set is the union of all page counts ever seen, so a
page referenced by a sheet or finding can never be orphaned; staleness is
surfaced by the drift flag, not by deletion.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, Integer, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimdossier_api.models.document import Document


class PdfPage(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "pdf_pages"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    # The PDF "drawing" Document (primary_file_type='pdf') this page belongs to.
    # CASCADE: deleting the document removes its pages (and aligned_sheets/
    # findings cascade/null off the page in turn).
    pdf_document_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    # 1-indexed page number (human convention; cf. the 0-based positional index a
    # PDF version exposes, converted at the boundary).
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)

    document: Mapped[Document] = relationship()

    __table_args__ = (
        Index("ix_pdf_pages_document_id", "pdf_document_id"),
        # Idempotency key for find-or-create: one active page per (document,
        # number). Partial so soft-deleted rows are exempt (pages are not
        # soft-deleted in practice, but keep the pattern consistent with the
        # other tenant tables).
        Index(
            "uq_pdf_pages_document_page",
            "pdf_document_id",
            "page_number",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
