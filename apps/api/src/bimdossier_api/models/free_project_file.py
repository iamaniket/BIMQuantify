"""Pooled free-tier files — `public.pooled_project_files`.

The pooled analog of `models.project_file.ProjectFile` (the `model_source` facet
only — free is IFC-only and single-role). A `PooledProjectFile` is one version of a
`PooledDocument` container (see `free_document.PooledDocument`); the document holds
many versions anchored by `(pooled_document_id, version_number)`, with the F7 head
pinned by `pooled_documents.head_file_id`.

Pooled-in-`public`, isolation by owner-keyed RLS on `owner_user_id` plus
owner-OR-member visibility resolved through the parent document's project (see
`_rls_sql`). `owner_user_id` is denormalized off the document so the RLS policy +
the superuser extraction callback key on this row directly.

Extraction state + the artifact `*_storage_key` columns mirror the paid
`ProjectFile` names verbatim so the paid `ProjectFileRead` / `ViewerBundleResponse`
schemas and `routers/project_files/_shared._presign_ifc_bundle` serialize free
rows unchanged. `converted_to_file_id` is the free→paid idempotency marker (set to
the new tenant `ProjectFile.id` at conversion; no cross-schema FK).

Differences from the paid `ProjectFile`: no `role` / attachment facet, no non-IFC
artifact columns (geometry / floor_plans / pdf_pages / detected_kind / page_count
/ ifc_project_guid). Status / extraction value sets are `String` + `CHECK` derived
from the paid enums (notably `extraction_status` uses the paid set —
`not_started`, not the legacy free `none` — so the values are identity).
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase
from bimdossier_api.models._pooled import PooledOwnedMixin, TimestampMixin, check_in
from bimdossier_api.models.project_file import ExtractionStatus, ProjectFileStatus

# Value sets derived from the paid enums so free CHECK constraints stay in
# lockstep and the values are identity with paid (so the paid ProjectFileRead /
# Zod schemas validate free rows unchanged).
POOLED_FILE_STATUSES: tuple[str, ...] = tuple(s.value for s in ProjectFileStatus)
POOLED_FILE_EXTRACTION_STATUSES: tuple[str, ...] = tuple(s.value for s in ExtractionStatus)


class PooledProjectFile(PooledOwnedMixin, TimestampMixin, MasterBase):
    __tablename__ = "pooled_project_files"

    # `owner_user_id` (from PooledOwnedMixin) is denormalized off the document so
    # the RLS policy + the superuser extraction callback key on it directly; it
    # stays = the project owner.
    pooled_document_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.pooled_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Who uploaded this version (owner or an invited editor). NULL only defensively.
    uploaded_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    version_number: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )

    # `free/<owner_user_id>/<pooled_document_id>/<file_id>.ifc`; artifacts alongside.
    # NON-unique (free divergence from paid FileBackedMixin.storage_key).
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ifc_schema: Mapped[str | None] = mapped_column(String(16), nullable=True)

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    extraction_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="not_started", server_default="not_started"
    )
    extraction_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    extraction_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    extraction_finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    extractor_version: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Artifact keys, stamped by the free callback once extraction succeeds. Named
    # to match the paid ProjectFile columns so _presign_ifc_bundle works unchanged.
    fragments_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    metadata_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    outline_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    properties_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Floor-plan (2D) artifact — the processor already generates it for free
    # architectural/mixed models (content auto-detection); stamped here so the
    # free viewer bundle can presign it and the unified viewer's 2D pane works.
    floor_plans_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # PDF artifacts (viewer parity). `geometry_storage_key` is the pdf_extraction
    # vector geometry the desktop viewer uses as the snap layer (named to match the
    # paid ProjectFile column). `page_count` drives fit-to-page / navigation.
    geometry_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Page-image manifest (pages.json) from `pdf_pages_rasterization`. The desktop
    # viewer renders PDFs from file_url + geometry, but the MOBILE viewer is
    # pdfjs-free and needs server-rasterized page images — stamped here by the free
    # pages-rasterization callback and presigned as `pdf_pages_url`. Mirrors the
    # paid ProjectFile.pdf_pages_storage_key column.
    pdf_pages_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Set at conversion to the new paid ProjectFile id (lives in a tenant schema,
    # so no cross-schema FK). Non-null = already converted → re-import is a no-op.
    converted_to_file_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    __table_args__ = (
        CheckConstraint("size_bytes >= 0", name="ck_pooled_project_files_size_nonneg"),
        CheckConstraint(
            check_in("status", POOLED_FILE_STATUSES),
            name="ck_pooled_project_files_status",
        ),
        CheckConstraint(
            check_in("extraction_status", POOLED_FILE_EXTRACTION_STATUSES),
            name="ck_pooled_project_files_extraction_status",
        ),
        # Versions: unique per document (mirrors paid ux_project_files_document_version).
        Index(
            "ux_pooled_project_files_document_version",
            "pooled_document_id",
            "version_number",
            unique=True,
        ),
        # Content dedup per (owner, document), active rows only. `deleted_at IS NULL`
        # is required so a soft-deleted row doesn't block re-upload of the same bytes.
        Index(
            "uq_pooled_project_files_doc_content_sha256",
            "owner_user_id",
            "pooled_document_id",
            "content_sha256",
            unique=True,
            postgresql_where=text(
                "content_sha256 IS NOT NULL AND status IN ('pending', 'ready') "
                "AND deleted_at IS NULL"
            ),
        ),
        Index("ix_pooled_project_files_owner", "owner_user_id"),
        Index("ix_pooled_project_files_document", "pooled_document_id"),
        Index("ix_pooled_project_files_extraction_status", "extraction_status"),
        {"schema": "public"},
    )
