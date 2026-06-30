import os
from typing import cast
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy import text as sql_text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.ratelimit import FREE_UPLOAD_INITIATE_LIMITER
from bimdossier_api.background.locks import lock_id_for
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.ifc.header import looks_like_zip, parse_ifc_header
from bimdossier_api.jobs import (
    FREE_TIER_SENTINEL_ORG,
    DispatchJobError,
    JobTier,
    dispatch_job,
)
from bimdossier_api.models.document import DocumentDiscipline
from bimdossier_api.models.pooled_document import PooledDocument
from bimdossier_api.models.pooled_project_file import PooledProjectFile
from bimdossier_api.models.user import User
from bimdossier_api.routers.free_access import (
    assert_can_create_free_content,
    pooled_owner_used_bytes,
)
from bimdossier_api.routers.pooled._shared import (
    _FREE_ALLOWED_EXT,
    _HEADER_PEEK_BYTES,
    _build_pooled_extraction_job,
    _claim_pooled_extraction_slot,
    _dispatch_pooled_pages_rasterization,
    _document_to_read,
    _load_accessible_document_or_404,
    _load_accessible_file_or_404,
    _load_owned_document_or_404,
    _load_owned_file_or_404,
    _presign_pooled_bundle,
    _reload_file,
    _resolve_pooled_head,
    _set_extraction_failed,
    _set_file_rejected,
    router,
)
from bimdossier_api.schemas.document import DocumentRead
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
from bimdossier_api.storage.scoping import pooled_key_prefix
from bimdossier_api.tenancy import get_pooled_session, open_pooled_session

# ---------------------------------------------------------------------------
# Files — two-phase upload
# ---------------------------------------------------------------------------


@router.post(
    "/projects/{project_id}/documents/{document_id}/files/initiate",
    response_model=InitiateUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(FREE_UPLOAD_INITIATE_LIMITER)],
)
async def initiate_pooled_file_upload(
    project_id: UUID,
    document_id: UUID,
    payload: InitiateUploadRequest,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
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
        {"k": lock_id_for(f"pooled_upload:{user.id}")},
    )
    if payload.size_bytes > settings.free_upload_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="FREE_UPLOAD_TOO_LARGE",
        )

    # Per-user aggregate storage cap (the 1 GB ceiling): the OWNER's model-file
    # bytes PLUS attachment (photo) bytes (FSL-1) — uploads are owner-only here, so
    # the owner's RLS session sees all of their own bytes.
    used_bytes = await pooled_owner_used_bytes(session, user.id)
    if used_bytes + payload.size_bytes > limits.storage_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="FREE_STORAGE_CAP_REACHED",
        )

    # Per-document content-hash dedup (pending + ready rows participate).
    existing = (
        await session.execute(
            select(PooledProjectFile)
            .where(
                PooledProjectFile.pooled_document_id == document.id,
                PooledProjectFile.content_sha256 == payload.content_sha256,
                PooledProjectFile.status.in_(("pending", "ready")),
                PooledProjectFile.deleted_at.is_(None),
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
    storage_key = f"{pooled_key_prefix(user.id)}{document.id}/{file_id}/source{ext}"
    max_version = (
        await session.scalar(
            select(func.coalesce(func.max(PooledProjectFile.version_number), 0)).where(
                PooledProjectFile.pooled_document_id == document.id
            )
        )
    ) or 0
    row = PooledProjectFile(
        id=file_id,
        owner_user_id=user.id,
        pooled_document_id=document.id,
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
async def complete_pooled_file_upload(
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
    async with open_pooled_session(user.id) as session:
        document = await _load_owned_document_or_404(session, project_id, document_id, user.id)
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
        async with open_pooled_session(user.id) as session:
            await session.execute(
                update(PooledProjectFile)
                .where(
                    PooledProjectFile.id == file_id,
                    PooledProjectFile.owner_user_id == user.id,
                )
                .values(status="ready", ifc_schema=ifc_schema)
            )
            await session.execute(
                update(PooledDocument)
                .where(
                    PooledDocument.id == document_id,
                    PooledDocument.owner_user_id == user.id,
                )
                # Lock type on first file (ifc or pdf); a newly-completed version
                # reclaims the head (clear any restore pointer).
                .values(
                    primary_file_type="pdf" if ext == ".pdf" else "ifc",
                    head_file_id=None,
                )
            )

    # Phase D — claim a global+per-user extraction slot, then dispatch.
    claimed = await _claim_pooled_extraction_slot(file_id, user.id, settings)
    if not claimed:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="FREE_EXTRACTION_BUSY",
        )

    detached = _build_pooled_extraction_job(
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
        await _set_extraction_failed(file_id, user.id, "dispatch failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="PROCESSOR_UNREACHABLE"
        ) from exc
    # Best-effort sibling: rasterize PDF pages so the mobile (pdfjs-free) viewer
    # can render this drawing. Never blocks/fails the file.
    if ext == ".pdf":
        await _dispatch_pooled_pages_rasterization(
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
async def retry_pooled_extraction(
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
    async with open_pooled_session(user.id) as session:
        document = await _load_owned_document_or_404(session, project_id, document_id, user.id)
        row = await _load_owned_file_or_404(session, document.id, file_id, user.id)
        if row.status != "ready":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="FILE_NOT_READY")
        if row.extraction_status != "failed":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="EXTRACTION_NOT_FAILED"
            )
        storage_key = row.storage_key
        ext = os.path.splitext(storage_key)[1].lower()
        doc_discipline = document.discipline

    claimed = await _claim_pooled_extraction_slot(file_id, user.id, settings)
    if not claimed:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="FREE_EXTRACTION_BUSY",
        )
    detached = _build_pooled_extraction_job(
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
        await _set_extraction_failed(file_id, user.id, "dispatch failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="PROCESSOR_UNREACHABLE"
        ) from exc
    # Best-effort sibling: rasterize PDF pages so the mobile (pdfjs-free) viewer
    # can render this drawing. Never blocks/fails the file.
    if ext == ".pdf":
        await _dispatch_pooled_pages_rasterization(
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
async def restore_pooled_version(
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
) -> DocumentRead:
    """Make an older version the current head (F7). Repoints head_file_id; no
    bytes copied, no new row. Source must be ready + extraction-succeeded and not
    already the head."""
    document = await _load_owned_document_or_404(session, project_id, document_id, user.id)
    source = await _load_owned_file_or_404(session, document.id, file_id, user.id)
    if source.status != "ready" or source.extraction_status != "succeeded":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="SOURCE_NOT_RESTORABLE")
    ready_versions = list(
        (
            await session.execute(
                select(PooledProjectFile)
                .where(
                    PooledProjectFile.pooled_document_id == document.id,
                    PooledProjectFile.status == "ready",
                    PooledProjectFile.deleted_at.is_(None),
                )
                .order_by(PooledProjectFile.version_number.desc())
            )
        )
        .scalars()
        .all()
    )
    if source.id == _resolve_pooled_head(document, ready_versions):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="VERSION_ALREADY_HEAD")
    document.head_file_id = source.id
    await session.flush()
    # Refresh so the onupdate-expired `updated_at` is re-fetched in the async
    # context (avoids an implicit lazy-load MissingGreenlet in _document_to_read).
    await session.refresh(document)
    return _document_to_read(document)


@router.get(
    "/projects/{project_id}/documents/{document_id}/files/{file_id}/viewer-bundle",
    response_model=ViewerBundleResponse,
)
async def pooled_file_viewer_bundle(
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
    storage: StorageBackend = Depends(get_storage),
) -> ViewerBundleResponse:
    document = await _load_accessible_document_or_404(session, project_id, document_id)
    row = await _load_accessible_file_or_404(session, document_id, file_id)
    # Readiness = extraction succeeded (IFC writes fragments, PDF writes geometry).
    if row.extraction_status != "succeeded":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="FREE_NOT_READY")
    # Stamp last-viewed on the container so the idle reaper doesn't reap it.
    document.last_viewed_at = func.now()
    return await _presign_pooled_bundle(row, storage)


@router.get(
    "/projects/{project_id}/viewer-bundle",
    response_model=ProjectViewerManifestResponse,
)
async def pooled_project_viewer_bundle(
    project_id: UUID,
    user: User = Depends(current_verified_user),
    session: AsyncSession = Depends(get_pooled_session),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectViewerManifestResponse:
    """Federated manifest: the head ready, extraction-succeeded version of every
    container in the project, each with presigned artifact URLs."""
    documents = list(
        (
            await session.execute(
                select(PooledDocument)
                .where(
                    PooledDocument.pooled_project_id == project_id,
                    PooledDocument.deleted_at.is_(None),
                )
                .order_by(PooledDocument.created_at)
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
                select(PooledProjectFile)
                .where(
                    PooledProjectFile.pooled_document_id.in_(list(doc_by_id.keys())),
                    PooledProjectFile.extraction_status == "succeeded",
                    PooledProjectFile.fragments_storage_key.is_not(None),
                    PooledProjectFile.deleted_at.is_(None),
                )
                .order_by(
                    PooledProjectFile.pooled_document_id,
                    PooledProjectFile.version_number.desc(),
                )
            )
        )
        .scalars()
        .all()
    )
    rows_by_doc: dict[UUID, list[PooledProjectFile]] = {}
    for r in rows:
        rows_by_doc.setdefault(r.pooled_document_id, []).append(r)
    chosen: list[tuple[PooledDocument, PooledProjectFile]] = []
    for d in documents:
        group = rows_by_doc.get(d.id, [])
        head_id = _resolve_pooled_head(d, group)
        head = next((r for r in group if r.id == head_id), None)
        if head is not None:
            chosen.append((d, head))
    entries: list[ProjectViewerDocumentEntry] = []
    for d, r in chosen:
        bundle = await _presign_pooled_bundle(r, storage)
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
