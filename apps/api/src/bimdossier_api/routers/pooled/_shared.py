"""Free-tier Document → ProjectFile API surface (the "free wedge", v2).

Pooled, org-less endpoints over `public.pooled_documents` / `public.pooled_project_files`
/ `public.pooled_findings` — the exact mirror of the paid `Document` (Container) →
`ProjectFile` (versioned model file) stack, so the portal renders free containers
through the identical paid components and the free→paid conversion is a near 1:1
row copy. IFC-only.

Replaces the old single-table `free_models` surface (`/free/models/*`): a free user
now creates a Container under a free project, then adds versioned model files to
it, exactly like a paid user.

Isolation: users hit `get_pooled_session` (search_path=public, ROLE bim_app, only
`app.current_user_id` set) — never `get_tenant_session`. Owner-OR-member RLS on
the free tables does it; the extraction callback runs as the superuser
(RLS-bypassing) and so must additionally validate every artifact key with
`assert_pooled_key_scoped`.

Surface (all under `/free`):
  POST   /projects/{pid}/documents                              create container
  GET    /projects/{pid}/documents                              list (with versions)
  GET    /projects/{pid}/documents/{did}                        container + versions
  PATCH  /projects/{pid}/documents/{did}                        rename / discipline / status
  DELETE /projects/{pid}/documents/{did}                        delete + objects
  POST   .../documents/{did}/files/initiate                     cap-enforced presigned PUT
  POST   .../documents/{did}/files/{fid}/complete              header parse + dispatch
  POST   .../documents/{did}/files/{fid}/retry-extraction      re-dispatch failed extraction
  POST   .../documents/{did}/files/{fid}/restore               F7 restore-version-as-head
  GET    .../documents/{did}/files/{fid}/viewer-bundle         presigned artifacts
  GET    /projects/{pid}/viewer-bundle                          federated manifest
  POST   /documents/{did}/findings                                 create snag
  GET    /documents/{did}/findings                                 list snags
  PATCH  /findings/{sid}                                           edit / close snag
  DELETE /findings/{sid}                                           delete snag
  POST   /internal/jobs/pooled-callback                           worker → write artifacts
"""

import logging
import os
from datetime import date
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimdossier_api.background.locks import lock_id_for
from bimdossier_api.config import Settings
from bimdossier_api.db import get_session_maker
from bimdossier_api.jobs import (
    FREE_TIER_SENTINEL_ORG,
    POOLED_CALLBACK_PATH,
    POOLED_PAGES_CALLBACK_PATH,
    DispatchJobError,
    JobTier,
    dispatch_job,
)
from bimdossier_api.models.document import DocumentDiscipline, DocumentStatus
from bimdossier_api.models.job import Job, JobStatus, JobType
from bimdossier_api.models.pooled_attachment import PooledAttachment
from bimdossier_api.models.pooled_document import PooledDocument
from bimdossier_api.models.pooled_finding import (
    POOLED_FINDING_NOTE_MAX,
    PooledFinding,
)
from bimdossier_api.models.pooled_finding_attachment import PooledFindingAttachment
from bimdossier_api.models.pooled_project_file import PooledProjectFile
from bimdossier_api.models.project_file import (
    ExtractionStatus,
    FileType,
    IfcSchema,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimdossier_api.routers.free_access import (
    require_free_tier_enabled,
)
from bimdossier_api.schemas.document import DocumentRead, DocumentWithVersions
from bimdossier_api.schemas.project_file import (
    ProjectFileRead,
    ViewerBundleResponse,
)
from bimdossier_api.storage import StorageBackend
from bimdossier_api.tenancy import open_pooled_session

# Free tier accepts IFC (3D) and PDF (2D drawings) — viewer parity. (.ifczip is a
# zipped IFC; .pdf is a 2D drawing rendered client-side by pdfjs.)
_FREE_ALLOWED_EXT = (".ifc", ".ifczip", ".pdf")
_HEADER_PEEK_BYTES = 2048
_ACTIVE_EXTRACTION = ("queued", "running")
_IFC_SCHEMA_VALUES = frozenset(s.value for s in IfcSchema)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/pooled",
    tags=["free-viewer"],
    dependencies=[Depends(require_free_tier_enabled)],
)
# Worker callback — secret-gated, NOT flag-gated (in-flight jobs must finish).
internal_router = APIRouter(prefix="/internal/jobs", tags=["internal"])


# ---------------------------------------------------------------------------
# Schemas (paid DocumentRead / ProjectFileRead / ViewerBundleResponse reused)
# ---------------------------------------------------------------------------


class PooledDocumentCreate(BaseModel):
    """Create a free container. Mirrors paid DocumentCreate (the project comes
    from the path). Discipline defaults to "other"; status to "active"."""

    name: str = Field(min_length=1, max_length=255)
    discipline: DocumentDiscipline = DocumentDiscipline.other
    status: DocumentStatus = DocumentStatus.active


class PooledDocumentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    discipline: DocumentDiscipline | None = None
    status: DocumentStatus | None = None
    # Assign a PDF drawing to a building level. Omitted = unchanged; explicit null
    # = Unassigned. Validated against the project's pooled_levels in the handler.
    level_id: UUID | None = Field(default=None)


class PooledFindingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=POOLED_FINDING_NOTE_MAX)
    severity: str = Field(default="medium")
    linked_file_type: str = Field(default="ifc", max_length=8)
    linked_file_id: UUID | None = None
    anchor_x: float | None = None
    anchor_y: float | None = None
    anchor_z: float | None = None
    anchor_page: int | None = None
    linked_element_global_id: str | None = Field(default=None, max_length=255)
    # Optional assignment — validated against the project's participants in the
    # handler. deadline_date is a plain calendar date (mirrors paid Finding).
    assigned_to_user_id: UUID | None = None
    deadline_date: date | None = None
    # Photo evidence: ids of pooled_attachments (uploaded via /free/projects/{id}/
    # attachments) to link as `kind='photo'`. Validated against the document's
    # project in the handler.
    photo_ids: list[UUID] | None = None


class PooledFindingUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=POOLED_FINDING_NOTE_MAX)
    severity: str | None = None
    status: str | None = None
    # An OMITTED field is left unchanged; an explicit null CLEARS the column
    # (the handler keys off model_dump(exclude_unset=True), mirroring the paid
    # update_finding). Only the nullable columns — assignee, deadline, note —
    # can be cleared; title/severity/status are NOT NULL and ignore a null.
    assigned_to_user_id: UUID | None = None
    deadline_date: date | None = None
    # Additive photo / resolution-evidence links (a present list APPENDS new ones;
    # never clears — link removal is a separate concern). Validated like create.
    photo_ids: list[UUID] | None = None
    resolution_evidence_ids: list[UUID] | None = None


class PooledCallbackRequest(BaseModel):
    # Mirrors the processor's CallbackPayload: it echoes `file_id` (= the
    # pooled_project_files row id we dispatched with) + the artifact keys it
    # uploaded. IFC sends fragments/metadata/outline/properties/floor_plans;
    # PDF (pdf_extraction) sends metadata + geometry + page_count. Extra processor
    # fields (organization_id, job_id, …) are ignored.
    file_id: UUID
    status: str  # running | succeeded | failed
    fragments_key: str | None = None
    metadata_key: str | None = None
    outline_key: str | None = None
    properties_key: str | None = None
    floor_plans_key: str | None = None
    # PDF metadata extraction sends geometry + page_count. The rasterized
    # page-image manifest (pdf_pages_key) arrives on a SEPARATE callback
    # (PooledPagesCallbackRequest) — extraction and rasterization are sibling jobs.
    geometry_key: str | None = None
    page_count: int | None = None
    extractor_version: str | None = None
    error: str | None = None


class PooledPagesCallbackRequest(BaseModel):
    # Mirrors the processor's PagesCallbackPayload for the `pdf_pages_rasterization`
    # sibling job. Echoes `file_id` (= the pooled_project_files row id) + the
    # page-image manifest key. Extra fields (organization_id, job_id, …) ignored.
    file_id: UUID
    status: str  # running | succeeded | failed
    pdf_pages_key: str | None = None
    page_count: int | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Adapters: free rows -> the paid DocumentWithVersions / ProjectFileRead shapes
# ---------------------------------------------------------------------------


def _coerce_ifc_schema(value: str | None) -> IfcSchema | None:
    return IfcSchema(value) if value in _IFC_SCHEMA_VALUES else None


def _file_to_read(f: PooledProjectFile, project_id: UUID) -> ProjectFileRead:
    return ProjectFileRead(
        id=f.id,
        role=ProjectFileRole.model_source,
        document_id=f.pooled_document_id,
        project_id=project_id,
        version_number=f.version_number,
        uploaded_by_user_id=f.uploaded_by_user_id or f.owner_user_id,
        original_filename=f.original_filename,
        size_bytes=f.size_bytes,
        content_type=f.content_type or "application/octet-stream",
        content_sha256=f.content_sha256,
        ifc_project_guid=None,
        # Derive the type from the stored object (free has no file_type column);
        # IFC vs PDF so listings/the viewer render the right thing.
        file_type=(
            FileType.pdf if os.path.splitext(f.storage_key)[1].lower() == ".pdf" else FileType.ifc
        ),
        ifc_schema=_coerce_ifc_schema(f.ifc_schema),
        status=ProjectFileStatus(f.status),
        rejection_reason=f.rejection_reason,
        extraction_status=ExtractionStatus(f.extraction_status),
        extraction_error=f.extraction_error,
        extraction_started_at=f.extraction_started_at,
        extraction_finished_at=f.extraction_finished_at,
        extractor_version=f.extractor_version,
        detected_kind=None,
        page_count=f.page_count,
        created_at=f.created_at,
        updated_at=f.updated_at,
    )


def _document_to_read(d: PooledDocument) -> DocumentRead:
    return DocumentRead(
        id=d.id,
        project_id=d.pooled_project_id,
        name=d.name,
        discipline=DocumentDiscipline(d.discipline),
        status=DocumentStatus(d.status),
        primary_file_type=FileType(d.primary_file_type) if d.primary_file_type else None,
        level_id=d.level_id,
        head_file_id=d.head_file_id,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


def _document_to_with_versions(
    d: PooledDocument, files: list[PooledProjectFile]
) -> DocumentWithVersions:
    base = _document_to_read(d)
    return DocumentWithVersions(
        **base.model_dump(),
        versions=[_file_to_read(f, d.pooled_project_id) for f in files],
    )


def _resolve_pooled_head(
    document: PooledDocument, candidates_desc: list[PooledProjectFile]
) -> UUID | None:
    """Free analog of resolve_head_file_id: the document's head_file_id when set
    and still among the candidates (version-desc), else the newest candidate."""
    if document.head_file_id is not None and any(
        c.id == document.head_file_id for c in candidates_desc
    ):
        return document.head_file_id
    return candidates_desc[0].id if candidates_desc else None


def _build_pooled_extraction_job(
    *,
    file_id: UUID,
    document_id: UUID,
    storage_key: str,
    ext: str,
    doc_discipline: str,
    settings: Settings,
) -> Job:
    """Build the detached extraction Job dispatched for a completed free file.

    `file_id` is echoed back as the callback identifier (= the pooled_project_files
    row id); the processor derives artifact keys from `storage_key`. Both job types
    route their callback to the free path. PDF runs ONLY `pdf_extraction` (no
    rasterization — the desktop viewer renders from file_url + geometry); IFC runs
    `ifc_extraction` with the free geometry threshold + declared discipline.
    """
    if ext == ".pdf":
        return Job(
            id=file_id,
            job_type=JobType.pdf_extraction,
            status=JobStatus.pending,
            payload={
                "file_id": str(file_id),
                "project_id": str(document_id),
                "storage_key": storage_key,
                "callback_path": POOLED_CALLBACK_PATH,
            },
        )
    return Job(
        id=file_id,
        job_type=JobType.ifc_extraction,
        status=JobStatus.pending,
        payload={
            "file_id": str(file_id),
            "project_id": str(document_id),
            "storage_key": storage_key,
            "callback_path": POOLED_CALLBACK_PATH,
            "geometry_threshold": settings.pooled_job_geometry_threshold,
            "compressed": ext == ".ifczip",
            "discipline": doc_discipline,
        },
    )


async def _dispatch_pooled_pages_rasterization(
    *, file_id: UUID, document_id: UUID, storage_key: str, settings: Settings
) -> None:
    """Best-effort dispatch of `pdf_pages_rasterization` for a free PDF.

    Mirrors the paid PDF path (a sibling job alongside pdf_extraction) so the
    pdfjs-free MOBILE viewer can render free PDF drawings. Distinct job id (the
    extraction job already owns `file_id` as its id) but echoes `file_id` in the
    payload as the callback target; routes to the free pages callback. Failure is
    swallowed — the page raster is an additive bonus and must never fail the file.
    """
    pages_job = Job(
        id=uuid4(),
        job_type=JobType.pdf_pages_rasterization,
        status=JobStatus.pending,
        payload={
            "file_id": str(file_id),
            "project_id": str(document_id),
            "storage_key": storage_key,
            "callback_path": POOLED_PAGES_CALLBACK_PATH,
        },
    )
    try:
        await dispatch_job(pages_job, settings, FREE_TIER_SENTINEL_ORG, tier=JobTier.free)
    except DispatchJobError:
        logger.warning(
            "free pdf_pages_rasterization dispatch failed for file %s",
            file_id,
            exc_info=True,
        )


# ---------------------------------------------------------------------------
# Viewer bundles
# ---------------------------------------------------------------------------


async def _presign_pooled_bundle(
    f: PooledProjectFile, storage: StorageBackend
) -> ViewerBundleResponse:
    async def _get(key: str | None, name: str) -> str | None:
        if key is None:
            return None
        return await storage.presigned_get_url(key, name)

    # A PDF drawing renders client-side (pdfjs) from the raw source + the vector
    # geometry snap layer on desktop; the pdfjs-free MOBILE viewer instead reads
    # the rasterized page-image manifest (pdf_pages_url) when present.
    if os.path.splitext(f.storage_key)[1].lower() == ".pdf":
        # Deferred import avoids any package import-order cycle through
        # routers.project_files at module load.
        from bimdossier_api.routers.project_files.access import (
            _build_pdf_pages_manifest_url,
        )

        pdf_pages_url = (
            await _build_pdf_pages_manifest_url(storage, f.pdf_pages_storage_key)
            if f.pdf_pages_storage_key is not None
            else None
        )
        return ViewerBundleResponse(
            file_type=FileType.pdf,
            file_url=await _get(f.storage_key, f.original_filename),
            geometry_url=await _get(f.geometry_storage_key, "geometry.json"),
            metadata_url=await _get(f.metadata_storage_key, "metadata.json"),
            pdf_pages_url=pdf_pages_url,
            expires_in=storage.presign_ttl,
        )

    return ViewerBundleResponse(
        file_type=FileType.ifc,
        fragments_url=await _get(f.fragments_storage_key, f"{f.original_filename}.frag"),
        fragments_key=f.fragments_storage_key,
        metadata_url=await _get(f.metadata_storage_key, "metadata.json"),
        properties_url=await _get(f.properties_storage_key, "properties.json"),
        outline_url=await _get(f.outline_storage_key, "outline.bin"),
        floor_plans_url=await _get(f.floor_plans_storage_key, "floor-plans.bin"),
        expires_in=storage.presign_ttl,
    )


# ---------------------------------------------------------------------------
# Snags (document-scoped)
# ---------------------------------------------------------------------------


async def _attach_links_to_snag(
    session: AsyncSession,
    snag: PooledFinding,
    document: PooledDocument,
    attachment_ids: list[UUID],
    kind: str,
) -> None:
    """Insert `pooled_finding_attachments` link rows of `kind` for `attachment_ids`.

    Each id must be a live `pooled_attachments` row in the document's project
    (RLS-scoped — the free session only sees the caller's accessible attachments),
    else 422 FREE_ATTACHMENT_NOT_FOUND. Already-linked ids are skipped (the
    (finding, attachment, kind) uniqueness). Inserts rows directly (not via the
    ORM relationship collection) so it never triggers an async lazy-load of
    `snag.attachment_links`; the caller refreshes that collection before reading
    `photo_ids`. Requires `snag.id` (flush the new snag first)."""
    if not attachment_ids:
        return
    found = set(
        (
            await session.execute(
                select(PooledAttachment.id).where(
                    PooledAttachment.id.in_(attachment_ids),
                    PooledAttachment.pooled_project_id == document.pooled_project_id,
                    PooledAttachment.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    missing = [a for a in attachment_ids if a not in found]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FREE_ATTACHMENT_NOT_FOUND",
        )
    existing = set(
        (
            await session.execute(
                select(PooledFindingAttachment.pooled_attachment_id).where(
                    PooledFindingAttachment.pooled_finding_id == snag.id,
                    PooledFindingAttachment.kind == kind,
                )
            )
        )
        .scalars()
        .all()
    )
    pos = len(existing)
    for att_id in attachment_ids:
        if att_id in existing:
            continue
        session.add(
            PooledFindingAttachment(
                pooled_finding_id=snag.id,
                pooled_attachment_id=att_id,
                owner_user_id=snag.owner_user_id,
                pooled_document_id=document.id,
                kind=kind,
                position=pos,
            )
        )
        existing.add(att_id)
        pos += 1


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_owned_document_or_404(
    session: AsyncSession, project_id: UUID, document_id: UUID, user_id: UUID
) -> PooledDocument:
    """OWNER-only container load (mutation paths). Explicit owner filter is
    belt-and-suspenders over RLS so a member can never reach a mutation path."""
    document = (
        await session.execute(
            select(PooledDocument).where(
                PooledDocument.id == document_id,
                PooledDocument.pooled_project_id == project_id,
                PooledDocument.owner_user_id == user_id,
                PooledDocument.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DOCUMENT_NOT_FOUND")
    return document


async def _load_accessible_document_or_404(
    session: AsyncSession, project_id: UUID, document_id: UUID
) -> PooledDocument:
    """PARTICIPANT container load (read paths) — owner OR shared-project member,
    scoped by RLS (no owner filter)."""
    document = (
        await session.execute(
            select(PooledDocument).where(
                PooledDocument.id == document_id,
                PooledDocument.pooled_project_id == project_id,
                PooledDocument.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DOCUMENT_NOT_FOUND")
    return document


async def _load_accessible_document_by_id_or_404(
    session: AsyncSession, document_id: UUID
) -> PooledDocument:
    """PARTICIPANT container load by id alone (snag paths carry no project id)."""
    document = (
        await session.execute(
            select(PooledDocument).where(
                PooledDocument.id == document_id, PooledDocument.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DOCUMENT_NOT_FOUND")
    return document


async def _load_owned_file_or_404(
    session: AsyncSession, document_id: UUID, file_id: UUID, user_id: UUID
) -> PooledProjectFile:
    row = (
        await session.execute(
            select(PooledProjectFile).where(
                PooledProjectFile.id == file_id,
                PooledProjectFile.pooled_document_id == document_id,
                PooledProjectFile.owner_user_id == user_id,
                PooledProjectFile.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_FOUND")
    return row


async def _load_accessible_file_or_404(
    session: AsyncSession, document_id: UUID, file_id: UUID
) -> PooledProjectFile:
    row = (
        await session.execute(
            select(PooledProjectFile).where(
                PooledProjectFile.id == file_id,
                PooledProjectFile.pooled_document_id == document_id,
                PooledProjectFile.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_FOUND")
    return row


async def _load_accessible_snag_or_404(session: AsyncSession, snag_id: UUID) -> PooledFinding:
    snag = (
        await session.execute(
            select(PooledFinding)
            .where(PooledFinding.id == snag_id)
            .options(selectinload(PooledFinding.attachment_links))
        )
    ).scalar_one_or_none()
    if snag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FREE_FINDING_NOT_FOUND")
    return snag


async def _reload_file(user_id: UUID, document_id: UUID, file_id: UUID) -> ProjectFileRead:
    async with open_pooled_session(user_id) as session:
        document = await _load_accessible_document_by_id_or_404(session, document_id)
        row = await _load_owned_file_or_404(session, document_id, file_id, user_id)
        return _file_to_read(row, document.pooled_project_id)


async def _set_file_rejected(user_id: UUID, file_id: UUID, reason: str) -> None:
    async with open_pooled_session(user_id) as session:
        await session.execute(
            update(PooledProjectFile)
            .where(
                PooledProjectFile.id == file_id,
                PooledProjectFile.owner_user_id == user_id,
            )
            .values(status="rejected", rejection_reason=reason)
        )


async def _set_extraction_failed(file_id: UUID, user_id: UUID, error: str) -> None:
    # Superuser session (RLS-bypassed) — the owner_user_id predicate is the only
    # structural guard, so it MUST be present (parity with _set_file_rejected /
    # _claim_pooled_extraction_slot). Without it a stray file_id would flip an
    # arbitrary user's row to failed.
    async with get_session_maker()() as session, session.begin():
        await session.execute(
            update(PooledProjectFile)
            .where(
                PooledProjectFile.id == file_id,
                PooledProjectFile.owner_user_id == user_id,
            )
            .values(extraction_status="failed", extraction_error=error)
        )


async def _claim_pooled_extraction_slot(file_id: UUID, user_id: UUID, settings: Settings) -> bool:
    """Atomically check the global + per-user free-extraction caps and claim a
    slot by flipping the file to `queued`. Runs in a SUPERUSER session (RLS
    bypassed) so the GLOBAL count sees every user's rows; a global advisory lock
    serializes the count-and-claim."""
    async with get_session_maker()() as session, session.begin():
        await session.execute(
            sql_text("SELECT pg_advisory_xact_lock(:k)"),
            {"k": lock_id_for("pooled_extraction:global")},
        )
        global_active = (
            await session.scalar(
                select(func.count())
                .select_from(PooledProjectFile)
                .where(PooledProjectFile.extraction_status.in_(_ACTIVE_EXTRACTION))
            )
        ) or 0
        if global_active >= settings.pooled_extraction_concurrency_global:
            return False
        user_active = (
            await session.scalar(
                select(func.count())
                .select_from(PooledProjectFile)
                .where(
                    PooledProjectFile.owner_user_id == user_id,
                    PooledProjectFile.extraction_status.in_(_ACTIVE_EXTRACTION),
                )
            )
        ) or 0
        if user_active >= settings.pooled_extraction_concurrency_per_user:
            return False
        await session.execute(
            update(PooledProjectFile)
            .where(
                PooledProjectFile.id == file_id,
                PooledProjectFile.owner_user_id == user_id,
            )
            .values(extraction_status="queued")
        )
    return True
