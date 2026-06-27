"""Upload endpoints: two-phase initiate/complete and retry-extraction.

The endpoints here are decorated with the per-file `router` imported from
`._shared`; importing this module registers them.
"""

from dataclasses import dataclass
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.access import (
    load_project_or_404,
    require_membership,
    require_project_writable,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.auth.ratelimit import UPLOAD_INITIATE_LIMITER
from bimdossier_api.cad.header import looks_like_dwg, looks_like_dxf
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.ifc.header import looks_like_zip, parse_ifc_header
from bimdossier_api.jobs import (
    DispatchJobError,
    JobConcurrencyError,
    check_job_concurrency,
    dispatch_job,
)
from bimdossier_api.jobs.lifecycle import retry_job as retry_job_lifecycle
from bimdossier_api.models.document import Document
from bimdossier_api.models.job import Job, JobStatus, JobType
from bimdossier_api.models.project_file import (
    ALLOWED_EXTENSIONS,
    ExtractionStatus,
    FileType,
    IfcSchema,
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.routers.documents import _load_document_or_404
from bimdossier_api.routers.project_files._shared import (
    HEADER_PEEK_BYTES,
    _load_file_or_404,
    logger,
    resolve_head_file_id,
    router,
)
from bimdossier_api.schemas.document import DocumentRead
from bimdossier_api.schemas.project_file import (
    InitiateUploadRequest,
    InitiateUploadResponse,
    ProjectFileRead,
)
from bimdossier_api.storage import StorageBackend, get_storage
from bimdossier_api.storage.minio import ObjectNotFoundError
from bimdossier_api.tenancy import (
    get_tenant_session,
    open_tenant_session,
    require_active_organization,
)


@router.post(
    "/initiate",
    response_model=InitiateUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(UPLOAD_INITIATE_LIMITER)],
)
async def initiate_upload(
    project_id: UUID,
    document_id: UUID,
    payload: InitiateUploadRequest,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> InitiateUploadResponse:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.project_file, Action.create)
    require_project_writable(project)

    document = await _load_document_or_404(session, project.id, document_id)

    fname_lower = payload.filename.lower()
    dot_pos = fname_lower.rfind(".")
    ext = fname_lower[dot_pos:] if dot_pos >= 0 else ""
    file_type = ALLOWED_EXTENSIONS.get(ext)
    if file_type is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_FILE_EXTENSION"
        )
    if payload.size_bytes > settings.upload_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="FILE_TOO_LARGE"
        )

    if document.primary_file_type is not None and document.primary_file_type != file_type:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "DOCUMENT_FILE_TYPE_LOCKED",
                "locked_to": document.primary_file_type.value,
            },
        )

    # Per-project content-hash dedup. Pending and ready rows participate;
    # rejected rows do not (their content was never accepted, by definition).
    existing = (
        await session.execute(
            select(ProjectFile)
            .join(Document, Document.id == ProjectFile.document_id)
            .where(
                Document.project_id == project.id,
                ProjectFile.content_sha256 == payload.content_sha256,
                ProjectFile.status.in_(
                    (ProjectFileStatus.pending, ProjectFileStatus.ready)
                ),
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
                "existing_filename": existing.original_filename,
                "existing_uploaded_at": existing.created_at.isoformat(),
                "existing_document_id": str(existing.document_id),
                "message": (
                    f"This file is identical to '{existing.original_filename}' "
                    "already in the project. Modify the file to upload a new version."
                ),
            },
        )

    storage_key = f"projects/{project.id}/documents/{document.id}/{uuid4()}{ext}"

    max_version = (
        await session.execute(
            select(func.coalesce(func.max(ProjectFile.version_number), 0)).where(
                ProjectFile.document_id == document.id
            )
        )
    ).scalar_one()
    new_version = int(max_version) + 1

    row = ProjectFile(
        project_id=project.id,
        role=ProjectFileRole.model_source,
        document_id=document.id,
        version_number=new_version,
        uploaded_by_user_id=user.id,
        storage_key=storage_key,
        original_filename=payload.filename,
        size_bytes=payload.size_bytes,
        content_type=payload.content_type,
        content_sha256=payload.content_sha256,
        file_type=file_type,
        status=ProjectFileStatus.pending,
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        # Two possible races: same version_number (ux_project_files_document_version)
        # or same content_sha256 within the project (uq_project_files_project_content_sha256).
        # Both surface the same 409 with a code distinguishing them.
        constraint = getattr(exc.orig, "constraint_name", None) or ""
        if "content_sha256" in constraint or "content_sha256" in str(exc.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "DUPLICATE_FILE_CONTENT",
                    "message": (
                        "This file is identical to one already in the project. "
                        "Modify the file to upload a new version."
                    ),
                },
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="VERSION_NUMBER_CONFLICT"
        ) from exc
    await session.refresh(row)

    upload_url = await storage.presigned_put_url(
        storage_key, payload.content_type, payload.size_bytes
    )

    await audit.record(
        session,
        action="project_file.initiated",
        resource_type="project_file",
        resource_id=row.id,
        after={
            "original_filename": row.original_filename,
            "file_type": row.file_type.value,
            "version_number": row.version_number,
            "document_id": str(document.id),
        },
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    return InitiateUploadResponse(
        file_id=row.id,
        upload_url=upload_url,
        storage_key=storage_key,
        expires_in=storage.presign_ttl,
    )


# --- complete_upload: file-type detection + job specs ----------------------
#
# complete_upload validates a freshly-uploaded object and queues extraction.
# Its S3 reads (HEAD + a single header peek) and the processor dispatch are
# network I/O, so they MUST NOT run while a tenant DB connection is held —
# otherwise a slow/unreachable processor pins a pooled connection for up to
# ~37s (two dispatches x the retry budget) and starves the pool under
# concurrency. We mirror the three-phase discipline in routers/compliance.py:
#   Phase 1 — validate + snapshot          (short tenant session)
#   Phase 2 — S3 HEAD + one header peek + magic-byte detection (NO connection)
#   Phase 3 — persist status + job rows + audit (short tenant session)
#   Phase 4 — dispatch the job(s)           (NO connection)
#   Phase 5 — on dispatch failure, mark rows failed (short tenant session)


@dataclass(frozen=True)
class _JobSpec:
    job_type: JobType
    payload: dict[str, str | bool]
    # A primary extraction job: a dispatch failure must also flip the file's
    # extraction_status to `failed`. Best-effort siblings (PDF rasterization)
    # leave the file untouched on dispatch failure.
    primary: bool


@dataclass(frozen=True)
class _CompleteDecision:
    accepted: bool
    audit_file_type: str
    rejection_reason: str | None = None
    set_ifc_schema: bool = False
    ifc_schema: IfcSchema | None = None
    clear_head: bool = False
    jobs: tuple[_JobSpec, ...] = ()


def _detect_completed_file(
    *,
    file_type: FileType,
    original_filename: str,
    head_bytes: bytes,
    project_id: UUID,
    file_id: UUID,
    storage_key: str,
    discipline: str | None = None,
) -> _CompleteDecision:
    """Pure magic-byte detection for a completed upload (no I/O, no session).

    Decides accept/reject and which extraction job(s) to queue. Runs in Phase 2
    with no DB connection held. A single ``head_bytes`` buffer (one S3 range
    read) feeds detection for every file type.
    """
    base: dict[str, str | bool] = {
        "file_id": str(file_id),
        "project_id": str(project_id),
        "storage_key": storage_key,
    }

    if file_type == FileType.pdf:
        if not head_bytes.startswith(b"%PDF"):
            return _CompleteDecision(False, "pdf", rejection_reason="FILE_NOT_VALID_PDF")
        # Primary PDF metadata extraction + a best-effort page rasterization for
        # the mobile viewer (independent; the processor re-reads the PDF itself).
        return _CompleteDecision(
            True,
            "pdf",
            clear_head=True,
            jobs=(
                _JobSpec(JobType.pdf_extraction, dict(base), primary=True),
                _JobSpec(JobType.pdf_pages_rasterization, dict(base), primary=False),
            ),
        )

    if file_type in (FileType.dxf, FileType.dwg):
        # CAD path. We only magic-byte sniff here; the processor parses DXF (and
        # converts DWG -> DXF via dwg2dxf first). The `source_format` flag tells
        # the worker whether to convert first.
        if file_type is FileType.dwg:
            accepted = looks_like_dwg(head_bytes)
            rejection = None if accepted else "FILE_NOT_VALID_DWG"
            source_format = "dwg"
        else:
            accepted = looks_like_dxf(head_bytes)
            rejection = None if accepted else "FILE_NOT_VALID_DXF"
            source_format = "dxf"
        if not accepted:
            return _CompleteDecision(False, file_type.value, rejection_reason=rejection)
        return _CompleteDecision(
            True,
            file_type.value,
            jobs=(
                _JobSpec(
                    JobType.dxf_extraction,
                    {**base, "source_format": source_format},
                    primary=True,
                ),
            ),
        )

    # IFC path. Compressed `.ifczip` is a zip wrapper whose schema can only be
    # read after decompression — verify only the zip magic and defer schema
    # validation to the processor. Uncompressed `.ifc` is STEP-header-sniffed.
    #
    # IFC extraction carries the parent document's declared discipline so the
    # processor's floor-plan gate can honor user intent (architectural /
    # coordination → plan; structural / mep → none; other → content auto-detect).
    ifc_base: dict[str, str | bool] = dict(base)
    if discipline is not None:
        ifc_base["discipline"] = discipline

    if original_filename.lower().endswith(".ifczip"):
        accepted = looks_like_zip(head_bytes)
        return _CompleteDecision(
            accepted,
            "ifc",
            rejection_reason=None if accepted else "FILE_NOT_VALID_IFCZIP",
            set_ifc_schema=True,
            ifc_schema=IfcSchema.unknown,
            clear_head=accepted,
            jobs=(
                (_JobSpec(JobType.ifc_extraction, {**ifc_base, "compressed": True}, primary=True),)
                if accepted
                else ()
            ),
        )

    result = parse_ifc_header(head_bytes)
    accepted = result.rejection is None and result.schema is not None
    return _CompleteDecision(
        accepted,
        "ifc",
        rejection_reason=result.rejection.value if result.rejection else None,
        set_ifc_schema=True,
        ifc_schema=result.schema,
        clear_head=accepted,
        jobs=(
            (_JobSpec(JobType.ifc_extraction, dict(ifc_base), primary=True),) if accepted else ()
        ),
    )


@router.post("/{file_id}/complete", response_model=ProjectFileRead)
async def complete_upload(
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    request: Request,
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ProjectFile:
    """Finalize a two-phase upload: validate the object, then queue extraction.

    The S3 reads and processor dispatch run with NO tenant DB connection held
    (Phases 2 and 4) so a slow/unreachable processor or object store can never
    pin a pooled connection and starve the pool — the same three-phase
    discipline as routers/compliance.py. Do NOT fold this back into a single
    get_tenant_session request.
    """
    schema: str = request.state.active_schema

    # --- Phase 1: validate + snapshot the values later phases need, then
    # release the connection.
    async with open_tenant_session(schema, active_org_id, user.id) as session:
        project = await load_project_or_404(session, project_id)
        membership = await require_membership(session, project.id, user.id)
        require_permission(membership.role, Resource.project_file, Action.create)
        require_project_writable(project)

        document = await _load_document_or_404(session, project.id, document_id)
        row = await _load_file_or_404(session, document.id, file_id)
        if row.status is not ProjectFileStatus.pending:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="FILE_ALREADY_FINALIZED"
            )
        storage_key = row.storage_key
        size_bytes = row.size_bytes
        file_type = row.file_type
        original_filename = row.original_filename
        project_uuid = project.id
        # The document's declared discipline drives the processor's floor-plan
        # gate (IFC only). Snapshotted here so Phase 2 can build the job payload
        # with no connection held.
        document_discipline = document.discipline.value

    # --- Phase 2: S3 HEAD + a single coalesced header read + magic-byte
    # detection, with NO DB connection held.
    try:
        head = await storage.head_object(storage_key)
    except ObjectNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="OBJECT_NOT_UPLOADED",
        ) from exc

    head_size = head.get("ContentLength")
    if isinstance(head_size, int) and head_size != size_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SIZE_MISMATCH"
        )

    range_end = min(HEADER_PEEK_BYTES - 1, max(size_bytes - 1, 0))
    head_bytes = await storage.get_object_range(storage_key, 0, range_end)

    decision = _detect_completed_file(
        file_type=file_type,
        original_filename=original_filename,
        head_bytes=head_bytes,
        project_id=project_uuid,
        file_id=file_id,
        storage_key=storage_key,
        discipline=document_discipline,
    )

    # A rejected upload's stored object is useless — delete it (no connection held).
    if not decision.accepted:
        try:
            await storage.delete_object(storage_key)
        except Exception:
            logger.warning(
                "Failed to delete rejected upload %s; row marked rejected anyway",
                storage_key,
                exc_info=True,
            )

    # --- Phase 3: persist the outcome + create job rows (pending) + audit, in a
    # fresh short transaction. Dispatch happens AFTER this commits (Phase 4).
    created_jobs: list[tuple[Job, _JobSpec]] = []
    async with open_tenant_session(schema, active_org_id, user.id) as session:
        document = await _load_document_or_404(session, project_id, document_id)
        row = await _load_file_or_404(session, document.id, file_id)
        # A concurrent request may have finalized the row between phases.
        if row.status is not ProjectFileStatus.pending:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="FILE_ALREADY_FINALIZED"
            )

        if decision.set_ifc_schema:
            row.ifc_schema = decision.ifc_schema

        if not decision.accepted:
            row.status = ProjectFileStatus.rejected
            row.rejection_reason = decision.rejection_reason or "UNKNOWN"
            await audit.record(
                session,
                action="project_file.rejected",
                resource_type="project_file",
                resource_id=row.id,
                after={
                    "rejection_reason": row.rejection_reason,
                    "file_type": decision.audit_file_type,
                },
                actor_user_id=user.id,
                project_id=project_uuid,
                request=request,
            )
            await session.flush()
            await session.refresh(row)
            return row

        row.status = ProjectFileStatus.ready
        row.extraction_status = ExtractionStatus.queued
        if document.primary_file_type is None:
            document.primary_file_type = row.file_type
        if decision.clear_head:
            # A newly-completed version reclaims the head: clear any restore
            # pointer so the document's effective head reverts to this version.
            document.head_file_id = None

        try:
            await check_job_concurrency(session, settings)
        except JobConcurrencyError as exc:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="TOO_MANY_ACTIVE_JOBS",
            ) from exc

        for spec in decision.jobs:
            job = Job(
                project_id=project_uuid,
                file_id=row.id,
                job_type=spec.job_type,
                status=JobStatus.pending,
                payload=dict(spec.payload),
                created_by_user_id=user.id,
            )
            session.add(job)
            await session.flush()
            created_jobs.append((job, spec))

        after: dict[str, object] = {
            "file_type": decision.audit_file_type,
            "original_filename": row.original_filename,
            "version_number": row.version_number,
        }
        if decision.set_ifc_schema:
            after["ifc_schema"] = row.ifc_schema.value if row.ifc_schema else None
        await audit.record(
            session,
            action="project_file.completed",
            resource_type="project_file",
            resource_id=row.id,
            after=after,
            actor_user_id=user.id,
            project_id=project_uuid,
            request=request,
        )
        await session.refresh(row)

    # --- Phase 4: dispatch the queued job(s) with NO DB connection held. The
    # job rows are committed `pending`; failures are recorded in Phase 5.
    failed: list[tuple[Job, _JobSpec, str]] = []
    for job, spec in created_jobs:
        try:
            await dispatch_job(job, settings, active_org_id)
        except DispatchJobError as exc:
            msg = f"DISPATCH_FAILED: {exc}"[:500]
            logger.warning("Worker dispatch failed for %s: %s", storage_key, exc)
            failed.append((job, spec, msg))

    if not failed:
        return row

    # --- Phase 5: record dispatch failures in a fresh short transaction. A
    # primary-job failure also flips the file's extraction_status to failed.
    async with open_tenant_session(schema, active_org_id, user.id) as session:
        document = await _load_document_or_404(session, project_id, document_id)
        row = await _load_file_or_404(session, document.id, file_id)
        for job, spec, msg in failed:
            failed_job = await session.get(Job, job.id)
            if failed_job is not None:
                failed_job.status = JobStatus.failed
                failed_job.error = msg
                failed_job.retriable = True
                failed_job.error_kind = "dispatch"
            if spec.primary:
                row.extraction_status = ExtractionStatus.failed
                row.extraction_error = msg
        await session.flush()
        await session.refresh(row)
    return row


@router.post("/{file_id}/retry-extraction", response_model=ProjectFileRead)
async def retry_extraction(
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    settings: Settings = Depends(get_settings),
) -> ProjectFile:
    """Re-dispatch extraction for a file whose previous attempt failed.

    Only valid when the row is `status=ready` and `extraction_status=failed`.
    Resets the extraction fields to `queued` and posts to the processor
    worker; the same DISPATCH_FAILED guard applies if the worker is
    unreachable.
    """
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.project_file, Action.update)
    require_project_writable(project)
    document = await _load_document_or_404(session, project.id, document_id)

    row = await _load_file_or_404(session, document.id, file_id)
    if row.status is not ProjectFileStatus.ready:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="FILE_NOT_READY")
    if row.extraction_status is not ExtractionStatus.failed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="EXTRACTION_NOT_FAILED")

    # Delegate to the generic lifecycle helper: it resets the linked file to
    # `queued`, mints a fresh Job (retry_of lineage, attempt+1) and re-dispatches.
    failed_job = (
        await session.execute(
            select(Job)
            .where(Job.file_id == row.id, Job.status == JobStatus.failed)
            .order_by(Job.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if failed_job is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="EXTRACTION_NOT_FAILED")

    await retry_job_lifecycle(
        session, failed_job, settings=settings, organization_id=active_org_id, user=user
    )

    await session.refresh(row)
    return row


@router.post("/{file_id}/restore", response_model=DocumentRead)
async def restore_version(
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Document:
    """Make an older document version the current head (F7 restore-version-as-head).

    Repoints ``document.head_file_id`` at the chosen version — no bytes are
    copied and no new version row is created, so the immutable version history is
    left untouched. The viewer/compliance follow the pointer (see
    ``resolve_head_file_id``); a later "upload new version" clears the pointer so
    the newest upload reclaims the head. The source must be a viewable version
    (``ready`` + extraction-succeeded, or a ``ready`` PDF) and not already the
    head.
    """
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.project_file, Action.update)
    require_project_writable(project)
    document = await _load_document_or_404(session, project.id, document_id)

    source = await _load_file_or_404(session, document.id, file_id)

    restorable = source.status is ProjectFileStatus.ready and (
        source.file_type is FileType.pdf
        or source.extraction_status is ExtractionStatus.succeeded
    )
    if not restorable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="SOURCE_NOT_RESTORABLE"
        )

    # Candidate set = the document's ready versions (what the portal treats as
    # selectable head), newest first. Restoring the current effective head is a
    # no-op and rejected so the action is meaningful.
    ready_versions = list(
        (
            await session.execute(
                select(ProjectFile)
                .where(
                    ProjectFile.document_id == document.id,
                    ProjectFile.status == ProjectFileStatus.ready,
                )
                .order_by(ProjectFile.version_number.desc())
            )
        )
        .scalars()
        .all()
    )
    if source.id == resolve_head_file_id(document, ready_versions):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="VERSION_ALREADY_HEAD"
        )

    document.head_file_id = source.id

    await audit.record(
        session,
        action="project_file.version_restored",
        resource_type="project_file",
        resource_id=source.id,
        after={
            "restored_from_version": source.version_number,
            "head_file_id": str(source.id),
            "document_id": str(document.id),
            "original_filename": source.original_filename,
        },
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    await session.flush()
    await session.refresh(document)
    return document
