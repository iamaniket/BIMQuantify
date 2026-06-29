"""Free-tier Document → ProjectFile API surface (the "free wedge", v2).

Pooled, org-less endpoints over `public.free_documents` / `public.free_project_files`
/ `public.free_findings` — the exact mirror of the paid `Document` (Container) →
`ProjectFile` (versioned model file) stack, so the portal renders free containers
through the identical paid components and the free→paid conversion is a near 1:1
row copy. IFC-only.

Replaces the old single-table `free_models` surface (`/free/models/*`): a free user
now creates a Container under a free project, then adds versioned model files to
it, exactly like a paid user.

Isolation: users hit `get_free_session` (search_path=public, ROLE bim_app, only
`app.current_user_id` set) — never `get_tenant_session`. Owner-OR-member RLS on
the free tables does it; the extraction callback runs as the superuser
(RLS-bypassing) and so must additionally validate every artifact key with
`assert_free_key_scoped`.

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
  POST   /internal/jobs/free-callback                           worker → write artifacts
"""

import logging
import os
from datetime import date
from typing import cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy import text as sql_text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.ratelimit import FREE_UPLOAD_INITIATE_LIMITER
from bimdossier_api.background.locks import lock_id_for
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.db import get_session_maker
from bimdossier_api.ifc.header import looks_like_zip, parse_ifc_header
from bimdossier_api.jobs import (
    FREE_CALLBACK_PATH,
    FREE_PAGES_CALLBACK_PATH,
    FREE_TIER_SENTINEL_ORG,
    DispatchJobError,
    JobTier,
    dispatch_job,
    require_worker_secret,
)
from bimdossier_api.models.document import DocumentDiscipline, DocumentStatus
from bimdossier_api.models.free_attachment import FreeAttachment
from bimdossier_api.models.free_document import FreeDocument
from bimdossier_api.models.free_finding import (
    FREE_FINDING_NOTE_MAX,
    FREE_FINDING_SEVERITIES,
    FREE_FINDING_STATUSES,
    FreeFinding,
)
from bimdossier_api.models.free_finding_attachment import FreeFindingAttachment
from bimdossier_api.models.free_level import FreeLevel
from bimdossier_api.models.free_project_file import FreeProjectFile
from bimdossier_api.models.free_project_member import FreeProjectMember
from bimdossier_api.models.job import Job, JobStatus, JobType
from bimdossier_api.models.project_file import (
    ExtractionStatus,
    FileType,
    IfcSchema,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.notifications.free_service import emit_free_job_notification
from bimdossier_api.routers.free_access import (
    assert_assignee_is_participant,
    assert_can_create_free_content,
    assert_free_account_not_expired,
    assert_free_project_owned,
    require_free_tier_enabled,
    require_free_write_role,
    resolve_free_document_role,
)
from bimdossier_api.schemas.document import DocumentRead, DocumentWithVersions
from bimdossier_api.schemas.project_file import (
    InitiateUploadRequest,
    InitiateUploadResponse,
    ProjectFileRead,
    ProjectViewerDocumentEntry,
    ProjectViewerManifestResponse,
    ViewerBundleResponse,
)
from bimdossier_api.storage import StorageBackend, get_storage
from bimdossier_api.storage.minio import ObjectNotFoundError
from bimdossier_api.storage.scoping import assert_free_key_scoped, free_key_prefix
from bimdossier_api.tenancy import get_free_session, open_free_session

# Free tier accepts IFC (3D) and PDF (2D drawings) — viewer parity. (.ifczip is a
# zipped IFC; .pdf is a 2D drawing rendered client-side by pdfjs.)
_FREE_ALLOWED_EXT = (".ifc", ".ifczip", ".pdf")
_HEADER_PEEK_BYTES = 2048
_ACTIVE_EXTRACTION = ("queued", "running")
_IFC_SCHEMA_VALUES = frozenset(s.value for s in IfcSchema)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/free",
    tags=["free-viewer"],
    dependencies=[Depends(require_free_tier_enabled)],
)
# Worker callback — secret-gated, NOT flag-gated (in-flight jobs must finish).
internal_router = APIRouter(prefix="/internal/jobs", tags=["internal"])


# ---------------------------------------------------------------------------
# Schemas (paid DocumentRead / ProjectFileRead / ViewerBundleResponse reused)
# ---------------------------------------------------------------------------


class FreeDocumentCreate(BaseModel):
    """Create a free container. Mirrors paid DocumentCreate (the project comes
    from the path). Discipline defaults to "other"; status to "active"."""

    name: str = Field(min_length=1, max_length=255)
    discipline: DocumentDiscipline = DocumentDiscipline.other
    status: DocumentStatus = DocumentStatus.active


class FreeDocumentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    discipline: DocumentDiscipline | None = None
    status: DocumentStatus | None = None
    # Assign a PDF drawing to a building level. Omitted = unchanged; explicit null
    # = Unassigned. Validated against the project's free_levels in the handler.
    level_id: UUID | None = Field(default=None)


class FreeFindingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=FREE_FINDING_NOTE_MAX)
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
    # Photo evidence: ids of free_attachments (uploaded via /free/projects/{id}/
    # attachments) to link as `kind='photo'`. Validated against the document's
    # project in the handler.
    photo_ids: list[UUID] | None = None


class FreeFindingUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=FREE_FINDING_NOTE_MAX)
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


class FreeFindingRead(BaseModel):
    id: UUID
    free_document_id: UUID
    linked_file_id: UUID | None
    title: str
    note: str | None
    severity: str
    status: str
    linked_file_type: str
    anchor_x: float | None
    anchor_y: float | None
    anchor_z: float | None
    anchor_page: int | None
    linked_element_global_id: str | None
    assigned_to_user_id: UUID | None
    deadline_date: date | None
    photo_ids: list[UUID] | None = None
    resolution_evidence_ids: list[UUID] | None = None

    @classmethod
    def of(cls, s: FreeFinding) -> "FreeFindingRead":
        return cls(
            id=s.id,
            free_document_id=s.free_document_id,
            linked_file_id=s.linked_file_id,
            title=s.title,
            note=s.note,
            severity=s.severity,
            status=s.status,
            linked_file_type=s.linked_file_type,
            anchor_x=s.anchor_x,
            anchor_y=s.anchor_y,
            anchor_z=s.anchor_z,
            anchor_page=s.anchor_page,
            linked_element_global_id=s.linked_element_global_id,
            assigned_to_user_id=s.assigned_to_user_id,
            deadline_date=s.deadline_date,
            photo_ids=s.photo_ids,
            resolution_evidence_ids=s.resolution_evidence_ids,
        )


class FreeCallbackRequest(BaseModel):
    # Mirrors the processor's CallbackPayload: it echoes `file_id` (= the
    # free_project_files row id we dispatched with) + the artifact keys it
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
    # (FreePagesCallbackRequest) — extraction and rasterization are sibling jobs.
    geometry_key: str | None = None
    page_count: int | None = None
    extractor_version: str | None = None
    error: str | None = None


class FreePagesCallbackRequest(BaseModel):
    # Mirrors the processor's PagesCallbackPayload for the `pdf_pages_rasterization`
    # sibling job. Echoes `file_id` (= the free_project_files row id) + the
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


def _file_to_read(f: FreeProjectFile, project_id: UUID) -> ProjectFileRead:
    return ProjectFileRead(
        id=f.id,
        role=ProjectFileRole.model_source,
        document_id=f.free_document_id,
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
            FileType.pdf
            if os.path.splitext(f.storage_key)[1].lower() == ".pdf"
            else FileType.ifc
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


def _document_to_read(d: FreeDocument) -> DocumentRead:
    return DocumentRead(
        id=d.id,
        project_id=d.free_project_id,
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
    d: FreeDocument, files: list[FreeProjectFile]
) -> DocumentWithVersions:
    base = _document_to_read(d)
    return DocumentWithVersions(
        **base.model_dump(),
        versions=[_file_to_read(f, d.free_project_id) for f in files],
    )


def _resolve_free_head(
    document: FreeDocument, candidates_desc: list[FreeProjectFile]
) -> UUID | None:
    """Free analog of resolve_head_file_id: the document's head_file_id when set
    and still among the candidates (version-desc), else the newest candidate."""
    if document.head_file_id is not None and any(
        c.id == document.head_file_id for c in candidates_desc
    ):
        return document.head_file_id
    return candidates_desc[0].id if candidates_desc else None


# ---------------------------------------------------------------------------
# Document CRUD
# ---------------------------------------------------------------------------


@router.post(
    "/projects/{project_id}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_free_document(
    project_id: UUID,
    payload: FreeDocumentCreate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    settings: Settings = Depends(get_settings),
) -> DocumentRead:
    # Create-gate: only org-less users (trial still open) may create free CONTENT;
    # only the project owner may add containers to it. Returns effective caps.
    limits = await assert_can_create_free_content(user)
    await assert_free_project_owned(session, project_id, user.id)
    # Serialize this user's concurrent creates so the per-user container cap can't
    # be TOCTOU-raced (transaction-scoped; released at commit).
    await session.execute(
        sql_text("SELECT pg_advisory_xact_lock(:k)"),
        {"k": lock_id_for(f"free_doc:{user.id}")},
    )
    existing = (
        await session.scalar(
            select(func.count())
            .select_from(FreeDocument)
            .where(
                FreeDocument.owner_user_id == user.id,
                FreeDocument.deleted_at.is_(None),
            )
        )
    ) or 0
    if existing >= limits.max_documents:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="FREE_MODEL_CAP_REACHED"
        )

    document = FreeDocument(
        owner_user_id=user.id,
        free_project_id=project_id,
        name=payload.name,
        discipline=payload.discipline.value,
        status=payload.status.value,
    )
    session.add(document)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="DOCUMENT_NAME_CONFLICT"
        ) from exc
    return _document_to_read(document)


@router.get(
    "/projects/{project_id}/documents",
    response_model=list[DocumentWithVersions],
)
async def list_free_project_documents(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> list[DocumentWithVersions]:
    # Participant-readable: RLS scopes visibility to owner + shared-project members.
    documents = list(
        (
            await session.execute(
                select(FreeDocument)
                .where(
                    FreeDocument.free_project_id == project_id,
                    FreeDocument.deleted_at.is_(None),
                )
                .order_by(FreeDocument.created_at)
            )
        )
        .scalars()
        .all()
    )
    if not documents:
        return []
    files = list(
        (
            await session.execute(
                select(FreeProjectFile)
                .where(
                    FreeProjectFile.free_document_id.in_([d.id for d in documents]),
                    FreeProjectFile.deleted_at.is_(None),
                )
                .order_by(
                    FreeProjectFile.free_document_id,
                    FreeProjectFile.version_number.desc(),
                )
            )
        )
        .scalars()
        .all()
    )
    files_by_doc: dict[UUID, list[FreeProjectFile]] = {}
    for f in files:
        files_by_doc.setdefault(f.free_document_id, []).append(f)
    return [_document_to_with_versions(d, files_by_doc.get(d.id, [])) for d in documents]


@router.get(
    "/projects/{project_id}/documents/{document_id}",
    response_model=DocumentWithVersions,
)
async def get_free_document(
    project_id: UUID,
    document_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> DocumentWithVersions:
    document = await _load_accessible_document_or_404(session, project_id, document_id)
    files = list(
        (
            await session.execute(
                select(FreeProjectFile)
                .where(
                    FreeProjectFile.free_document_id == document_id,
                    FreeProjectFile.deleted_at.is_(None),
                )
                .order_by(FreeProjectFile.version_number.desc())
            )
        )
        .scalars()
        .all()
    )
    return _document_to_with_versions(document, files)


@router.patch(
    "/projects/{project_id}/documents/{document_id}",
    response_model=DocumentRead,
)
async def update_free_document(
    project_id: UUID,
    document_id: UUID,
    payload: FreeDocumentUpdate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> DocumentRead:
    document = await _load_owned_document_or_404(session, project_id, document_id, user.id)
    await assert_free_account_not_expired(user)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        document.name = data["name"]
    if "discipline" in data and data["discipline"] is not None:
        document.discipline = data["discipline"].value
    if "status" in data and data["status"] is not None:
        document.status = data["status"].value
    # Assign/clear the building level (PDF drawings). Explicit null = Unassigned;
    # a non-null id must be a live level in THIS project (clean 404, not an FK 500).
    if "level_id" in data:
        new_level_id = data["level_id"]
        if new_level_id is not None:
            exists = await session.scalar(
                select(FreeLevel.id).where(
                    FreeLevel.id == new_level_id,
                    FreeLevel.free_project_id == project_id,
                    FreeLevel.deleted_at.is_(None),
                )
            )
            if exists is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="LEVEL_NOT_FOUND"
                )
        document.level_id = new_level_id
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="DOCUMENT_NAME_CONFLICT"
        ) from exc
    # Refresh so the onupdate-expired `updated_at` is re-fetched in the async
    # context (avoids an implicit lazy-load MissingGreenlet in _document_to_read).
    await session.refresh(document)
    return _document_to_read(document)


@router.delete(
    "/projects/{project_id}/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_free_document(
    project_id: UUID,
    document_id: UUID,
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> None:
    async with open_free_session(user.id) as session:
        document = await _load_owned_document_or_404(
            session, project_id, document_id, user.id
        )
        prefix = f"{free_key_prefix(user.id)}{document_id}/"
        await session.delete(document)  # cascades free_project_files + free_findings
    # Storage cleanup after the rows are gone (best-effort; reaper backstops).
    await storage.delete_prefix(prefix)


# ---------------------------------------------------------------------------
# Files — two-phase upload
# ---------------------------------------------------------------------------


def _build_free_extraction_job(
    *,
    file_id: UUID,
    document_id: UUID,
    storage_key: str,
    ext: str,
    doc_discipline: str,
    settings: Settings,
) -> Job:
    """Build the detached extraction Job dispatched for a completed free file.

    `file_id` is echoed back as the callback identifier (= the free_project_files
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
                "callback_path": FREE_CALLBACK_PATH,
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
            "callback_path": FREE_CALLBACK_PATH,
            "geometry_threshold": settings.free_job_geometry_threshold,
            "compressed": ext == ".ifczip",
            "discipline": doc_discipline,
        },
    )


async def _dispatch_free_pages_rasterization(
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
            "callback_path": FREE_PAGES_CALLBACK_PATH,
        },
    )
    try:
        await dispatch_job(
            pages_job, settings, FREE_TIER_SENTINEL_ORG, tier=JobTier.free
        )
    except DispatchJobError:
        logger.warning(
            "free pdf_pages_rasterization dispatch failed for file %s", file_id,
            exc_info=True,
        )


@router.post(
    "/projects/{project_id}/documents/{document_id}/files/initiate",
    response_model=InitiateUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(FREE_UPLOAD_INITIATE_LIMITER)],
)
async def initiate_free_file_upload(
    project_id: UUID,
    document_id: UUID,
    payload: InitiateUploadRequest,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> InitiateUploadResponse:
    ext = os.path.splitext(payload.filename)[1].lower()
    if ext not in _FREE_ALLOWED_EXT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_FILE_EXTENSION"
        )
    # Uploads are owner-only (a member may snag but never add a version).
    limits = await assert_can_create_free_content(user)
    document = await _load_owned_document_or_404(session, project_id, document_id, user.id)
    # Serialize this user's concurrent initiates so the aggregate-storage cap
    # can't be TOCTOU-raced (transaction-scoped; released at commit).
    await session.execute(
        sql_text("SELECT pg_advisory_xact_lock(:k)"),
        {"k": lock_id_for(f"free_upload:{user.id}")},
    )
    if payload.size_bytes > settings.free_upload_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="FREE_UPLOAD_TOO_LARGE",
        )

    # Per-user aggregate storage cap (the 1 GB ceiling): sum the OWNER's own file
    # bytes across all versions (members can't upload, so it's owner-only).
    used_bytes = (
        await session.scalar(
            select(func.coalesce(func.sum(FreeProjectFile.size_bytes), 0)).where(
                FreeProjectFile.owner_user_id == user.id,
                FreeProjectFile.deleted_at.is_(None),
            )
        )
    ) or 0
    if used_bytes + payload.size_bytes > limits.storage_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="FREE_STORAGE_CAP_REACHED",
        )

    # Per-document content-hash dedup (pending + ready rows participate).
    existing = (
        await session.execute(
            select(FreeProjectFile)
            .where(
                FreeProjectFile.free_document_id == document.id,
                FreeProjectFile.content_sha256 == payload.content_sha256,
                FreeProjectFile.status.in_(("pending", "ready")),
                FreeProjectFile.deleted_at.is_(None),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "DUPLICATE_FILE_CONTENT",
                "existing_file_id": str(existing.id),
                "message": (
                    "This file is identical to one already in this container. "
                    "Modify the file to upload a new version."
                ),
            },
        )

    file_id = uuid4()
    storage_key = f"{free_key_prefix(user.id)}{document.id}/{file_id}/source{ext}"
    max_version = (
        await session.scalar(
            select(func.coalesce(func.max(FreeProjectFile.version_number), 0)).where(
                FreeProjectFile.free_document_id == document.id
            )
        )
    ) or 0
    row = FreeProjectFile(
        id=file_id,
        owner_user_id=user.id,
        free_document_id=document.id,
        uploaded_by_user_id=user.id,
        version_number=int(max_version) + 1,
        storage_key=storage_key,
        original_filename=payload.filename,
        size_bytes=payload.size_bytes,
        content_type=payload.content_type,
        content_sha256=payload.content_sha256,
        status="pending",
        extraction_status="not_started",
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="VERSION_NUMBER_CONFLICT"
        ) from exc
    upload_url = await storage.presigned_put_url(
        storage_key, payload.content_type, payload.size_bytes
    )
    return InitiateUploadResponse(
        file_id=file_id,
        upload_url=upload_url,
        storage_key=storage_key,
        expires_in=storage.presign_ttl,
    )


@router.post(
    "/projects/{project_id}/documents/{document_id}/files/{file_id}/complete",
    response_model=ProjectFileRead,
)
async def complete_free_file_upload(
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ProjectFileRead:
    """Finalize a two-phase free upload: validate the object then queue extraction.

    The S3 reads + processor dispatch run with NO DB connection held (the free
    pool is the shared pool) — the same multi-phase discipline as the paid
    complete_upload."""
    await assert_can_create_free_content(user)
    # Phase A — load + snapshot (short free session). Validate document ownership,
    # then snapshot the file row's fields the later phases need.
    async with open_free_session(user.id) as session:
        document = await _load_owned_document_or_404(
            session, project_id, document_id, user.id
        )
        row = await _load_owned_file_or_404(session, document_id, file_id, user.id)
        storage_key = row.storage_key
        cur_status = row.status
        cur_extraction = row.extraction_status
        ext = os.path.splitext(storage_key)[1].lower()
        # Snapshot the declared discipline so the processor can honor it at the
        # floor-plan gate (architectural/coordination → on, structural/mep → off,
        # other/unset → content auto-detect). Captured while the session is open.
        doc_discipline = document.discipline

    if cur_status == "rejected":
        return await _reload_file(user.id, document_id, file_id)
    if cur_status == "ready" and cur_extraction not in ("not_started", "failed"):
        return await _reload_file(user.id, document_id, file_id)  # idempotent

    if cur_status == "pending":
        # Phase B — HEAD + header peek (no DB connection held).
        try:
            head = await storage.head_object(storage_key)
        except ObjectNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="OBJECT_NOT_UPLOADED"
            ) from exc
        actual = int(cast("int", head.get("ContentLength", 0) or 0))
        if actual > settings.free_upload_max_bytes:
            await _set_file_rejected(user.id, file_id, "FREE_UPLOAD_TOO_LARGE")
            return await _reload_file(user.id, document_id, file_id)
        peek = await storage.get_object_range(storage_key, 0, _HEADER_PEEK_BYTES - 1)

        rejection: str | None = None
        ifc_schema: str | None = None
        if ext == ".pdf":
            if not peek.startswith(b"%PDF"):
                rejection = "FILE_NOT_VALID_PDF"
        elif ext == ".ifczip":
            if not looks_like_zip(peek):
                rejection = "FILE_NOT_VALID_IFCZIP"
        else:
            result = parse_ifc_header(peek)
            if result.rejection is not None:
                rejection = result.rejection.value
            elif result.schema is not None:
                ifc_schema = result.schema.value

        if rejection is not None:
            await _set_file_rejected(user.id, file_id, rejection)
            return await _reload_file(user.id, document_id, file_id)

        # Phase C — flip to ready, lock the document type, reclaim the head.
        async with open_free_session(user.id) as session:
            await session.execute(
                update(FreeProjectFile)
                .where(
                    FreeProjectFile.id == file_id,
                    FreeProjectFile.owner_user_id == user.id,
                )
                .values(status="ready", ifc_schema=ifc_schema)
            )
            await session.execute(
                update(FreeDocument)
                .where(
                    FreeDocument.id == document_id,
                    FreeDocument.owner_user_id == user.id,
                )
                # Lock type on first file (ifc or pdf); a newly-completed version
                # reclaims the head (clear any restore pointer).
                .values(
                    primary_file_type="pdf" if ext == ".pdf" else "ifc",
                    head_file_id=None,
                )
            )

    # Phase D — claim a global+per-user extraction slot, then dispatch.
    claimed = await _claim_free_extraction_slot(file_id, user.id, settings)
    if not claimed:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="FREE_EXTRACTION_BUSY",
        )

    detached = _build_free_extraction_job(
        file_id=file_id,
        document_id=document_id,
        storage_key=storage_key,
        ext=ext,
        doc_discipline=doc_discipline,
        settings=settings,
    )
    try:
        await dispatch_job(detached, settings, FREE_TIER_SENTINEL_ORG, tier=JobTier.free)
    except DispatchJobError as exc:
        await _set_extraction_failed(file_id, "dispatch failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="PROCESSOR_UNREACHABLE"
        ) from exc
    # Best-effort sibling: rasterize PDF pages so the mobile (pdfjs-free) viewer
    # can render this drawing. Never blocks/fails the file.
    if ext == ".pdf":
        await _dispatch_free_pages_rasterization(
            file_id=file_id,
            document_id=document_id,
            storage_key=storage_key,
            settings=settings,
        )
    return await _reload_file(user.id, document_id, file_id)


@router.post(
    "/projects/{project_id}/documents/{document_id}/files/{file_id}/retry-extraction",
    response_model=ProjectFileRead,
)
async def retry_free_extraction(
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ProjectFileRead:
    """Re-dispatch extraction for a free file whose previous attempt failed (only
    valid when status=ready and extraction_status=failed)."""
    await assert_can_create_free_content(user)
    async with open_free_session(user.id) as session:
        document = await _load_owned_document_or_404(
            session, project_id, document_id, user.id
        )
        row = await _load_owned_file_or_404(session, document.id, file_id, user.id)
        if row.status != "ready":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="FILE_NOT_READY"
            )
        if row.extraction_status != "failed":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="EXTRACTION_NOT_FAILED"
            )
        storage_key = row.storage_key
        ext = os.path.splitext(storage_key)[1].lower()
        doc_discipline = document.discipline

    claimed = await _claim_free_extraction_slot(file_id, user.id, settings)
    if not claimed:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="FREE_EXTRACTION_BUSY",
        )
    detached = _build_free_extraction_job(
        file_id=file_id,
        document_id=document_id,
        storage_key=storage_key,
        ext=ext,
        doc_discipline=doc_discipline,
        settings=settings,
    )
    try:
        await dispatch_job(detached, settings, FREE_TIER_SENTINEL_ORG, tier=JobTier.free)
    except DispatchJobError as exc:
        await _set_extraction_failed(file_id, "dispatch failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="PROCESSOR_UNREACHABLE"
        ) from exc
    # Best-effort sibling: rasterize PDF pages so the mobile (pdfjs-free) viewer
    # can render this drawing. Never blocks/fails the file.
    if ext == ".pdf":
        await _dispatch_free_pages_rasterization(
            file_id=file_id,
            document_id=document_id,
            storage_key=storage_key,
            settings=settings,
        )
    return await _reload_file(user.id, document_id, file_id)


@router.post(
    "/projects/{project_id}/documents/{document_id}/files/{file_id}/restore",
    response_model=DocumentRead,
)
async def restore_free_version(
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> DocumentRead:
    """Make an older version the current head (F7). Repoints head_file_id; no
    bytes copied, no new row. Source must be ready + extraction-succeeded and not
    already the head."""
    document = await _load_owned_document_or_404(session, project_id, document_id, user.id)
    source = await _load_owned_file_or_404(session, document.id, file_id, user.id)
    if source.status != "ready" or source.extraction_status != "succeeded":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="SOURCE_NOT_RESTORABLE"
        )
    ready_versions = list(
        (
            await session.execute(
                select(FreeProjectFile)
                .where(
                    FreeProjectFile.free_document_id == document.id,
                    FreeProjectFile.status == "ready",
                    FreeProjectFile.deleted_at.is_(None),
                )
                .order_by(FreeProjectFile.version_number.desc())
            )
        )
        .scalars()
        .all()
    )
    if source.id == _resolve_free_head(document, ready_versions):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="VERSION_ALREADY_HEAD"
        )
    document.head_file_id = source.id
    await session.flush()
    # Refresh so the onupdate-expired `updated_at` is re-fetched in the async
    # context (avoids an implicit lazy-load MissingGreenlet in _document_to_read).
    await session.refresh(document)
    return _document_to_read(document)


# ---------------------------------------------------------------------------
# Viewer bundles
# ---------------------------------------------------------------------------


async def _presign_free_bundle(
    f: FreeProjectFile, storage: StorageBackend
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


@router.get(
    "/projects/{project_id}/documents/{document_id}/files/{file_id}/viewer-bundle",
    response_model=ViewerBundleResponse,
)
async def free_file_viewer_bundle(
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
) -> ViewerBundleResponse:
    document = await _load_accessible_document_or_404(session, project_id, document_id)
    row = await _load_accessible_file_or_404(session, document_id, file_id)
    # Readiness = extraction succeeded (IFC writes fragments, PDF writes geometry).
    if row.extraction_status != "succeeded":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="FREE_NOT_READY")
    # Stamp last-viewed on the container so the idle reaper doesn't reap it.
    document.last_viewed_at = func.now()
    return await _presign_free_bundle(row, storage)


@router.get(
    "/projects/{project_id}/viewer-bundle",
    response_model=ProjectViewerManifestResponse,
)
async def free_project_viewer_bundle(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectViewerManifestResponse:
    """Federated manifest: the head ready, extraction-succeeded version of every
    container in the project, each with presigned artifact URLs."""
    documents = list(
        (
            await session.execute(
                select(FreeDocument)
                .where(
                    FreeDocument.free_project_id == project_id,
                    FreeDocument.deleted_at.is_(None),
                )
                .order_by(FreeDocument.created_at)
            )
        )
        .scalars()
        .all()
    )
    if not documents:
        return ProjectViewerManifestResponse(expires_in=storage.presign_ttl, models=[])
    doc_by_id = {d.id: d for d in documents}
    rows = list(
        (
            await session.execute(
                select(FreeProjectFile)
                .where(
                    FreeProjectFile.free_document_id.in_(list(doc_by_id.keys())),
                    FreeProjectFile.extraction_status == "succeeded",
                    FreeProjectFile.fragments_storage_key.is_not(None),
                    FreeProjectFile.deleted_at.is_(None),
                )
                .order_by(
                    FreeProjectFile.free_document_id,
                    FreeProjectFile.version_number.desc(),
                )
            )
        )
        .scalars()
        .all()
    )
    rows_by_doc: dict[UUID, list[FreeProjectFile]] = {}
    for r in rows:
        rows_by_doc.setdefault(r.free_document_id, []).append(r)
    chosen: list[tuple[FreeDocument, FreeProjectFile]] = []
    for d in documents:
        group = rows_by_doc.get(d.id, [])
        head_id = _resolve_free_head(d, group)
        head = next((r for r in group if r.id == head_id), None)
        if head is not None:
            chosen.append((d, head))
    entries: list[ProjectViewerDocumentEntry] = []
    for d, r in chosen:
        bundle = await _presign_free_bundle(r, storage)
        entries.append(
            ProjectViewerDocumentEntry(
                file_id=r.id,
                model_id=d.id,
                model_name=d.name,
                discipline=DocumentDiscipline(d.discipline),
                detected_kind=None,
                fragments_url=bundle.fragments_url,
                fragments_key=r.fragments_storage_key,
                metadata_url=bundle.metadata_url,
                properties_url=bundle.properties_url,
                outline_url=bundle.outline_url,
                floor_plans_url=bundle.floor_plans_url,
            )
        )
    return ProjectViewerManifestResponse(expires_in=storage.presign_ttl, models=entries)


# ---------------------------------------------------------------------------
# Snags (document-scoped)
# ---------------------------------------------------------------------------


async def _attach_links_to_snag(
    session: AsyncSession,
    snag: FreeFinding,
    document: FreeDocument,
    attachment_ids: list[UUID],
    kind: str,
) -> None:
    """Insert `free_finding_attachments` link rows of `kind` for `attachment_ids`.

    Each id must be a live `free_attachments` row in the document's project
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
                select(FreeAttachment.id).where(
                    FreeAttachment.id.in_(attachment_ids),
                    FreeAttachment.free_project_id == document.free_project_id,
                    FreeAttachment.deleted_at.is_(None),
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
                select(FreeFindingAttachment.free_attachment_id).where(
                    FreeFindingAttachment.free_finding_id == snag.id,
                    FreeFindingAttachment.kind == kind,
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
            FreeFindingAttachment(
                free_finding_id=snag.id,
                free_attachment_id=att_id,
                owner_user_id=snag.owner_user_id,
                free_document_id=document.id,
                kind=kind,
                position=pos,
            )
        )
        existing.add(att_id)
        pos += 1


@router.post(
    "/documents/{document_id}/findings",
    response_model=FreeFindingRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_free_finding(
    document_id: UUID,
    payload: FreeFindingCreate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> FreeFindingRead:
    if payload.severity not in FREE_FINDING_SEVERITIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VALIDATION_ERROR"
        )
    document = await _load_accessible_document_by_id_or_404(session, document_id)
    require_free_write_role(await resolve_free_document_role(session, document, user.id))
    await assert_free_account_not_expired(user)
    if payload.assigned_to_user_id is not None:
        await assert_assignee_is_participant(
            document.free_project_id, payload.assigned_to_user_id
        )
    snag = FreeFinding(
        free_document_id=document_id,
        linked_file_id=payload.linked_file_id,
        # owner_user_id stays = the project owner (the RLS/quota key) even when a
        # member files the snag; created_by_user_id records the real author.
        owner_user_id=document.owner_user_id,
        created_by_user_id=user.id,
        title=payload.title,
        note=payload.note,
        severity=payload.severity,
        status="open",
        linked_file_type=payload.linked_file_type,
        anchor_x=payload.anchor_x,
        anchor_y=payload.anchor_y,
        anchor_z=payload.anchor_z,
        anchor_page=payload.anchor_page,
        linked_element_global_id=payload.linked_element_global_id,
        assigned_to_user_id=payload.assigned_to_user_id,
        deadline_date=payload.deadline_date,
    )
    session.add(snag)
    await session.flush()  # assign snag.id before linking attachments
    if payload.photo_ids:
        await _attach_links_to_snag(session, snag, document, payload.photo_ids, "photo")
        await session.flush()
    # Eager-load the links so `photo_ids` reads them in-memory (no async lazy-load).
    await session.refresh(snag, attribute_names=["attachment_links"])
    return FreeFindingRead.of(snag)


@router.get("/documents/{document_id}/findings", response_model=list[FreeFindingRead])
async def list_free_findings(
    document_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> list[FreeFindingRead]:
    await _load_accessible_document_by_id_or_404(session, document_id)
    rows = (
        await session.execute(
            select(FreeFinding)
            .where(FreeFinding.free_document_id == document_id)
            .options(selectinload(FreeFinding.attachment_links))
            .order_by(FreeFinding.created_at.asc())
        )
    ).scalars().all()
    return [FreeFindingRead.of(s) for s in rows]


@router.get("/findings/{finding_id}", response_model=FreeFindingRead)
async def get_free_finding(
    finding_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> FreeFindingRead:
    """Single free snag (mobile `useFinding` + offline 422-conflict refetch). RLS
    scopes visibility to participants; 404 otherwise."""
    snag = await _load_accessible_snag_or_404(session, finding_id)
    return FreeFindingRead.of(snag)


@router.patch("/findings/{finding_id}", response_model=FreeFindingRead)
async def update_free_finding(
    finding_id: UUID,
    payload: FreeFindingUpdate,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> FreeFindingRead:
    snag = await _load_accessible_snag_or_404(session, finding_id)
    document = await _load_accessible_document_by_id_or_404(session, snag.free_document_id)
    require_free_write_role(await resolve_free_document_role(session, document, user.id))
    await assert_free_account_not_expired(user)

    # exclude_unset distinguishes an OMITTED field (leave unchanged) from an
    # explicit null (clear the column), mirroring the paid update_finding.
    updates = payload.model_dump(exclude_unset=True)
    # Photo / resolution-evidence links are relationship side-effects, not column
    # setattrs (photo_ids is a read-only property) — pull them out and apply via
    # the link helper below. A present list APPENDS; it never clears.
    add_photo_ids = updates.pop("photo_ids", None)
    add_evidence_ids = updates.pop("resolution_evidence_ids", None)

    # Validate the String+CHECK enum columns by hand (paid uses real enums). A
    # present-but-null severity/status is ignored below — those are NOT NULL.
    if updates.get("severity") is not None and updates["severity"] not in FREE_FINDING_SEVERITIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VALIDATION_ERROR"
        )
    if updates.get("status") is not None and updates["status"] not in FREE_FINDING_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="VALIDATION_ERROR"
        )
    # A non-null assignee must be a project participant (clean 422, not an FK
    # 500); an explicit null clears the assignment with no check.
    if updates.get("assigned_to_user_id") is not None:
        await assert_assignee_is_participant(
            document.free_project_id, updates["assigned_to_user_id"]
        )

    # title/severity/status are NOT NULL — guard against a stray explicit null;
    # assignee/deadline/note (nullable) clear when set to None.
    non_nullable = {"title", "severity", "status"}
    for field, value in updates.items():
        if value is None and field in non_nullable:
            continue
        setattr(snag, field, value)
    links_changed = bool(add_photo_ids) or bool(add_evidence_ids)
    if add_photo_ids:
        await _attach_links_to_snag(session, snag, document, add_photo_ids, "photo")
    if add_evidence_ids:
        await _attach_links_to_snag(
            session, snag, document, add_evidence_ids, "resolution_evidence"
        )
    await session.flush()
    # New link rows were inserted directly, so reload the (already eager-loaded)
    # collection to reflect them before reading photo_ids / resolution_evidence_ids.
    if links_changed:
        await session.refresh(snag, attribute_names=["attachment_links"])
    return FreeFindingRead.of(snag)


@router.delete("/findings/{finding_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_free_finding(
    finding_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_free_session),
) -> None:
    snag = await _load_accessible_snag_or_404(session, finding_id)
    document = await _load_accessible_document_by_id_or_404(session, snag.free_document_id)
    require_free_write_role(await resolve_free_document_role(session, document, user.id))
    await session.delete(snag)


# ---------------------------------------------------------------------------
# Worker callback (secret-gated, superuser session — RLS-bypassing)
# ---------------------------------------------------------------------------


@internal_router.post("/free-callback", status_code=status.HTTP_200_OK)
async def free_extraction_callback(
    payload: FreeCallbackRequest,
    _: None = Depends(require_worker_secret),
) -> dict[str, bool]:
    # Notification inputs captured inside the txn, emitted POST-commit (best-effort,
    # never blocking/failing the worker callback). None = no notification (running /
    # idempotent no-op).
    notify: dict[str, object] | None = None
    async with get_session_maker()() as session, session.begin():
        # Superuser session bypasses RLS — operate cross-user by id, so every
        # artifact key MUST be validated against the OWNER's prefix below.
        row = await session.get(FreeProjectFile, payload.file_id, with_for_update=True)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="FREE_FILE_NOT_FOUND"
            )
        if row.extraction_status in ("succeeded", "failed"):
            return {"ok": True}  # terminal — idempotent no-op

        owner = row.owner_user_id
        if payload.status == "running":
            row.extraction_status = "running"
            row.extraction_started_at = func.now()
        elif payload.status == "succeeded":
            for key in (
                payload.fragments_key,
                payload.metadata_key,
                payload.outline_key,
                payload.properties_key,
                payload.floor_plans_key,
                payload.geometry_key,
            ):
                assert_free_key_scoped(key, owner)
            row.fragments_storage_key = payload.fragments_key
            row.metadata_storage_key = payload.metadata_key
            row.outline_storage_key = payload.outline_key
            row.properties_storage_key = payload.properties_key
            row.floor_plans_storage_key = payload.floor_plans_key
            # PDF artifacts (None for IFC; fragments None for PDF).
            row.geometry_storage_key = payload.geometry_key
            row.page_count = payload.page_count
            row.extraction_status = "succeeded"
            row.extraction_error = None
            row.extraction_finished_at = func.now()
            row.extractor_version = payload.extractor_version
        elif payload.status == "failed":
            row.extraction_status = "failed"
            row.extraction_error = (payload.error or "extraction failed")[:2000]
            row.extraction_finished_at = func.now()
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="VALIDATION_ERROR",
            )

        # On a terminal state, capture the fan-out set (owner + invited members of
        # the model's project) so the post-commit emit can notify each recipient.
        if payload.status in ("succeeded", "failed"):
            project_id = await session.scalar(
                select(FreeDocument.free_project_id).where(
                    FreeDocument.id == row.free_document_id
                )
            )
            member_ids = (
                (
                    await session.execute(
                        select(FreeProjectMember.user_id).where(
                            FreeProjectMember.free_project_id == project_id
                        )
                    )
                )
                .scalars()
                .all()
                if project_id is not None
                else []
            )
            notify = {
                "event_type": (
                    "job_succeeded" if payload.status == "succeeded" else "job_failed"
                ),
                "recipients": list({owner, *member_ids}),
                "file_id": row.id,
                "document_id": row.free_document_id,
                "project_id": project_id,
                "filename": row.original_filename,
                "error": payload.error if payload.status == "failed" else None,
            }

    if notify is not None:
        await emit_free_job_notification(**notify)  # type: ignore[arg-type]
    return {"ok": True}


@internal_router.post("/free-pages-callback", status_code=status.HTTP_200_OK)
async def free_pages_rasterization_callback(
    payload: FreePagesCallbackRequest,
    _: None = Depends(require_worker_secret),
) -> dict[str, bool]:
    """Worker → API callback for the free `pdf_pages_rasterization` sibling job.

    Records the page-image manifest key on the free file so the pdfjs-free mobile
    viewer can render the PDF. Additive — never touches `extraction_status`
    (pdf_extraction owns that field), so it sidesteps the terminal-state guard in
    the extraction callback. Superuser session (RLS-bypassing), so the key is
    validated against the OWNER's prefix. Idempotent + best-effort: a non-success
    status (or a vanished file) is a no-op, since the page raster is a bonus."""
    if payload.status != "succeeded" or payload.pdf_pages_key is None:
        return {"ok": True}
    async with get_session_maker()() as session, session.begin():
        row = await session.get(FreeProjectFile, payload.file_id, with_for_update=True)
        if row is None:
            return {"ok": True}  # file gone — nothing to stamp
        assert_free_key_scoped(payload.pdf_pages_key, row.owner_user_id)
        row.pdf_pages_storage_key = payload.pdf_pages_key
        if payload.page_count is not None and row.page_count is None:
            row.page_count = payload.page_count
    return {"ok": True}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_owned_document_or_404(
    session: AsyncSession, project_id: UUID, document_id: UUID, user_id: UUID
) -> FreeDocument:
    """OWNER-only container load (mutation paths). Explicit owner filter is
    belt-and-suspenders over RLS so a member can never reach a mutation path."""
    document = (
        await session.execute(
            select(FreeDocument).where(
                FreeDocument.id == document_id,
                FreeDocument.free_project_id == project_id,
                FreeDocument.owner_user_id == user_id,
                FreeDocument.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="DOCUMENT_NOT_FOUND"
        )
    return document


async def _load_accessible_document_or_404(
    session: AsyncSession, project_id: UUID, document_id: UUID
) -> FreeDocument:
    """PARTICIPANT container load (read paths) — owner OR shared-project member,
    scoped by RLS (no owner filter)."""
    document = (
        await session.execute(
            select(FreeDocument).where(
                FreeDocument.id == document_id,
                FreeDocument.free_project_id == project_id,
                FreeDocument.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="DOCUMENT_NOT_FOUND"
        )
    return document


async def _load_accessible_document_by_id_or_404(
    session: AsyncSession, document_id: UUID
) -> FreeDocument:
    """PARTICIPANT container load by id alone (snag paths carry no project id)."""
    document = (
        await session.execute(
            select(FreeDocument).where(
                FreeDocument.id == document_id, FreeDocument.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="DOCUMENT_NOT_FOUND"
        )
    return document


async def _load_owned_file_or_404(
    session: AsyncSession, document_id: UUID, file_id: UUID, user_id: UUID
) -> FreeProjectFile:
    row = (
        await session.execute(
            select(FreeProjectFile).where(
                FreeProjectFile.id == file_id,
                FreeProjectFile.free_document_id == document_id,
                FreeProjectFile.owner_user_id == user_id,
                FreeProjectFile.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_FOUND")
    return row


async def _load_accessible_file_or_404(
    session: AsyncSession, document_id: UUID, file_id: UUID
) -> FreeProjectFile:
    row = (
        await session.execute(
            select(FreeProjectFile).where(
                FreeProjectFile.id == file_id,
                FreeProjectFile.free_document_id == document_id,
                FreeProjectFile.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_FOUND")
    return row


async def _load_accessible_snag_or_404(
    session: AsyncSession, snag_id: UUID
) -> FreeFinding:
    snag = (
        await session.execute(
            select(FreeFinding)
            .where(FreeFinding.id == snag_id)
            .options(selectinload(FreeFinding.attachment_links))
        )
    ).scalar_one_or_none()
    if snag is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="FREE_FINDING_NOT_FOUND"
        )
    return snag


async def _reload_file(
    user_id: UUID, document_id: UUID, file_id: UUID
) -> ProjectFileRead:
    async with open_free_session(user_id) as session:
        document = await _load_accessible_document_by_id_or_404(session, document_id)
        row = await _load_owned_file_or_404(session, document_id, file_id, user_id)
        return _file_to_read(row, document.free_project_id)


async def _set_file_rejected(user_id: UUID, file_id: UUID, reason: str) -> None:
    async with open_free_session(user_id) as session:
        await session.execute(
            update(FreeProjectFile)
            .where(
                FreeProjectFile.id == file_id,
                FreeProjectFile.owner_user_id == user_id,
            )
            .values(status="rejected", rejection_reason=reason)
        )


async def _set_extraction_failed(file_id: UUID, error: str) -> None:
    async with get_session_maker()() as session, session.begin():
        await session.execute(
            update(FreeProjectFile)
            .where(FreeProjectFile.id == file_id)
            .values(extraction_status="failed", extraction_error=error)
        )


async def _claim_free_extraction_slot(
    file_id: UUID, user_id: UUID, settings: Settings
) -> bool:
    """Atomically check the global + per-user free-extraction caps and claim a
    slot by flipping the file to `queued`. Runs in a SUPERUSER session (RLS
    bypassed) so the GLOBAL count sees every user's rows; a global advisory lock
    serializes the count-and-claim."""
    async with get_session_maker()() as session, session.begin():
        await session.execute(
            sql_text("SELECT pg_advisory_xact_lock(:k)"),
            {"k": lock_id_for("free_extraction:global")},
        )
        global_active = (
            await session.scalar(
                select(func.count())
                .select_from(FreeProjectFile)
                .where(FreeProjectFile.extraction_status.in_(_ACTIVE_EXTRACTION))
            )
        ) or 0
        if global_active >= settings.free_extraction_concurrency_global:
            return False
        user_active = (
            await session.scalar(
                select(func.count())
                .select_from(FreeProjectFile)
                .where(
                    FreeProjectFile.owner_user_id == user_id,
                    FreeProjectFile.extraction_status.in_(_ACTIVE_EXTRACTION),
                )
            )
        ) or 0
        if user_active >= settings.free_extraction_concurrency_per_user:
            return False
        await session.execute(
            update(FreeProjectFile)
            .where(
                FreeProjectFile.id == file_id,
                FreeProjectFile.owner_user_id == user_id,
            )
            .values(extraction_status="queued")
        )
    return True
