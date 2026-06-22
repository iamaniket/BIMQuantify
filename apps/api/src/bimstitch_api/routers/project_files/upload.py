"""Upload endpoints: two-phase initiate/complete and retry-extraction.

The endpoints here are decorated with the per-file `router` imported from
`._shared`; importing this module registers them.
"""

from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.access import (
    load_project_or_404,
    require_membership,
    require_project_writable,
)
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.auth.ratelimit import UPLOAD_INITIATE_LIMITER
from bimstitch_api.cad.header import looks_like_dwg, looks_like_dxf
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.ifc.header import looks_like_zip, parse_ifc_header
from bimstitch_api.jobs import (
    DispatchJobError,
    JobConcurrencyError,
    check_job_concurrency,
    dispatch_job,
)
from bimstitch_api.jobs.lifecycle import retry_job as retry_job_lifecycle
from bimstitch_api.models.job import Job, JobStatus, JobType
from bimstitch_api.models.model import Model
from bimstitch_api.models.project_file import (
    ALLOWED_EXTENSIONS,
    ExtractionStatus,
    FileType,
    IfcSchema,
    ProjectFile,
    ProjectFileRole,
    ProjectFileStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.routers.models import _load_model_or_404
from bimstitch_api.routers.project_files._shared import (
    HEADER_PEEK_BYTES,
    logger,
    router,
    _load_file_or_404,
)
from bimstitch_api.schemas.project_file import (
    InitiateUploadRequest,
    InitiateUploadResponse,
    ProjectFileRead,
)
from bimstitch_api.storage import StorageBackend, get_storage
from bimstitch_api.storage.minio import ObjectNotFoundError
from bimstitch_api.tenancy import get_tenant_session, require_active_organization


@router.post(
    "/initiate",
    response_model=InitiateUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(UPLOAD_INITIATE_LIMITER)],
)
async def initiate_upload(
    project_id: UUID,
    model_id: UUID,
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

    model = await _load_model_or_404(session, project.id, model_id)

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

    if model.primary_file_type is not None and model.primary_file_type != file_type:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "MODEL_FILE_TYPE_LOCKED",
                "locked_to": model.primary_file_type.value,
            },
        )

    # Per-project content-hash dedup. Pending and ready rows participate;
    # rejected rows do not (their content was never accepted, by definition).
    existing = (
        await session.execute(
            select(ProjectFile)
            .join(Model, Model.id == ProjectFile.model_id)
            .where(
                Model.project_id == project.id,
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
                "existing_model_id": str(existing.model_id),
                "message": (
                    f"This file is identical to '{existing.original_filename}' "
                    "already in the project. Modify the file to upload a new version."
                ),
            },
        )

    storage_key = f"projects/{project.id}/models/{model.id}/{uuid4()}{ext}"

    max_version = (
        await session.execute(
            select(func.coalesce(func.max(ProjectFile.version_number), 0)).where(
                ProjectFile.model_id == model.id
            )
        )
    ).scalar_one()
    new_version = int(max_version) + 1

    row = ProjectFile(
        project_id=project.id,
        role=ProjectFileRole.model_source,
        model_id=model.id,
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
        # Two possible races: same version_number (ux_project_files_model_version)
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
            "model_id": str(model.id),
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


@router.post("/{file_id}/complete", response_model=ProjectFileRead)
async def complete_upload(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ProjectFile:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.project_file, Action.create)
    require_project_writable(project)

    model = await _load_model_or_404(session, project.id, model_id)
    row = await _load_file_or_404(session, model.id, file_id)
    if row.status is not ProjectFileStatus.pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="FILE_ALREADY_FINALIZED")

    try:
        head = await storage.head_object(row.storage_key)
    except ObjectNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="OBJECT_NOT_UPLOADED",
        ) from exc

    head_size = head.get("ContentLength")
    if isinstance(head_size, int) and head_size != row.size_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SIZE_MISMATCH"
        )

    if row.file_type == FileType.pdf:
        head_bytes = await storage.get_object_range(row.storage_key, 0, min(4, row.size_bytes - 1))
        if not head_bytes.startswith(b"%PDF"):
            row.status = ProjectFileStatus.rejected
            row.rejection_reason = "FILE_NOT_VALID_PDF"
            try:
                await storage.delete_object(row.storage_key)
            except Exception:
                logger.warning(
                    "Failed to delete rejected upload %s; row marked rejected anyway",
                    row.storage_key,
                    exc_info=True,
                )
            await audit.record(
                session,
                action="project_file.rejected",
                resource_type="project_file",
                resource_id=row.id,
                after={"rejection_reason": "FILE_NOT_VALID_PDF", "file_type": "pdf"},
                actor_user_id=user.id,
                project_id=project.id,
                request=request,
            )
            await session.flush()
            await session.refresh(row)
            return row

        row.status = ProjectFileStatus.ready
        row.extraction_status = ExtractionStatus.queued
        if model.primary_file_type is None:
            model.primary_file_type = row.file_type

        try:
            await check_job_concurrency(session, settings)
        except JobConcurrencyError:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="TOO_MANY_ACTIVE_JOBS",
            )

        pdf_job = Job(
            project_id=project.id,
            file_id=row.id,
            job_type=JobType.pdf_extraction,
            status=JobStatus.pending,
            payload={
                "file_id": str(row.id),
                "project_id": str(project.id),
                "storage_key": row.storage_key,
            },
            created_by_user_id=user.id,
        )
        session.add(pdf_job)
        await session.flush()

        try:
            await dispatch_job(pdf_job, settings, active_org_id)
        except DispatchJobError as exc:
            row.extraction_status = ExtractionStatus.failed
            row.extraction_error = f"DISPATCH_FAILED: {exc}"[:500]
            pdf_job.status = JobStatus.failed
            pdf_job.error = f"DISPATCH_FAILED: {exc}"[:500]
            pdf_job.retriable = True
            pdf_job.error_kind = "dispatch"
            logger.warning("Worker dispatch failed for %s: %s", row.storage_key, exc)
            await session.flush()

        await audit.record(
            session,
            action="project_file.completed",
            resource_type="project_file",
            resource_id=row.id,
            after={
                "file_type": "pdf",
                "original_filename": row.original_filename,
                "version_number": row.version_number,
            },
            actor_user_id=user.id,
            project_id=project.id,
            request=request,
        )

        await session.refresh(row)
        return row

    if row.file_type in (FileType.dxf, FileType.dwg):
        # CAD path. We only magic-byte sniff here; the processor parses DXF (and
        # converts DWG -> DXF via dwg2dxf first), then extracts geometry +
        # metadata. Both file types run the single `dxf_extraction` job; the
        # `source_format` payload flag tells the worker whether to convert first.
        range_end = min(HEADER_PEEK_BYTES - 1, max(row.size_bytes - 1, 0))
        head_bytes = await storage.get_object_range(row.storage_key, 0, range_end)

        if row.file_type is FileType.dwg:
            cad_accepted = looks_like_dwg(head_bytes)
            cad_rejection = None if cad_accepted else "FILE_NOT_VALID_DWG"
            source_format = "dwg"
        else:
            cad_accepted = looks_like_dxf(head_bytes)
            cad_rejection = None if cad_accepted else "FILE_NOT_VALID_DXF"
            source_format = "dxf"

        file_type_label = row.file_type.value

        if cad_accepted:
            row.status = ProjectFileStatus.ready
            row.extraction_status = ExtractionStatus.queued
            if model.primary_file_type is None:
                model.primary_file_type = row.file_type

            try:
                await check_job_concurrency(session, settings)
            except JobConcurrencyError:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="TOO_MANY_ACTIVE_JOBS",
                )

            cad_job = Job(
                project_id=project.id,
                file_id=row.id,
                job_type=JobType.dxf_extraction,
                status=JobStatus.pending,
                payload={
                    "file_id": str(row.id),
                    "project_id": str(project.id),
                    "storage_key": row.storage_key,
                    "source_format": source_format,
                },
                created_by_user_id=user.id,
            )
            session.add(cad_job)
            await session.flush()

            try:
                await dispatch_job(cad_job, settings, active_org_id)
            except DispatchJobError as exc:
                row.extraction_status = ExtractionStatus.failed
                row.extraction_error = f"DISPATCH_FAILED: {exc}"[:500]
                cad_job.status = JobStatus.failed
                cad_job.error = f"DISPATCH_FAILED: {exc}"[:500]
                cad_job.retriable = True
                cad_job.error_kind = "dispatch"
                logger.warning("Worker dispatch failed for %s: %s", row.storage_key, exc)
                await session.flush()

            await audit.record(
                session,
                action="project_file.completed",
                resource_type="project_file",
                resource_id=row.id,
                after={
                    "file_type": file_type_label,
                    "original_filename": row.original_filename,
                    "version_number": row.version_number,
                },
                actor_user_id=user.id,
                project_id=project.id,
                request=request,
            )

            await session.refresh(row)
            return row

        row.status = ProjectFileStatus.rejected
        row.rejection_reason = cad_rejection or "UNKNOWN"
        try:
            await storage.delete_object(row.storage_key)
        except Exception:
            logger.warning(
                "Failed to delete rejected upload %s; row marked rejected anyway",
                row.storage_key,
                exc_info=True,
            )
        await audit.record(
            session,
            action="project_file.rejected",
            resource_type="project_file",
            resource_id=row.id,
            after={"rejection_reason": row.rejection_reason, "file_type": file_type_label},
            actor_user_id=user.id,
            project_id=project.id,
            request=request,
        )
        await session.flush()
        await session.refresh(row)
        return row

    # IFC path. Uncompressed `.ifc` is STEP-header-sniffed here. Compressed
    # `.ifczip` is a zip wrapper whose schema can only be read after
    # decompression, so we verify only the zip magic and defer schema
    # validation to the processor (it rejects on UnsupportedSchemaError).
    is_compressed = row.original_filename.lower().endswith(".ifczip")
    range_end = min(HEADER_PEEK_BYTES - 1, max(row.size_bytes - 1, 0))
    head_bytes = await storage.get_object_range(row.storage_key, 0, range_end)

    if is_compressed:
        accepted = looks_like_zip(head_bytes)
        rejection_reason = None if accepted else "FILE_NOT_VALID_IFCZIP"
        row.ifc_schema = IfcSchema.unknown
    else:
        result = parse_ifc_header(head_bytes)
        accepted = result.rejection is None and result.schema is not None
        rejection_reason = result.rejection.value if result.rejection else None
        row.ifc_schema = result.schema

    if accepted:
        row.status = ProjectFileStatus.ready
        row.extraction_status = ExtractionStatus.queued
        if model.primary_file_type is None:
            model.primary_file_type = row.file_type

        try:
            await check_job_concurrency(session, settings)
        except JobConcurrencyError:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="TOO_MANY_ACTIVE_JOBS",
            )

        job_payload: dict[str, str | bool] = {
            "file_id": str(row.id),
            "project_id": str(project.id),
            "storage_key": row.storage_key,
        }
        if is_compressed:
            job_payload["compressed"] = True

        ifc_job = Job(
            project_id=project.id,
            file_id=row.id,
            job_type=JobType.ifc_extraction,
            status=JobStatus.pending,
            payload=job_payload,
            created_by_user_id=user.id,
        )
        session.add(ifc_job)
        await session.flush()

        try:
            await dispatch_job(ifc_job, settings, active_org_id)
        except DispatchJobError as exc:
            row.extraction_status = ExtractionStatus.failed
            row.extraction_error = f"DISPATCH_FAILED: {exc}"[:500]
            ifc_job.status = JobStatus.failed
            ifc_job.error = f"DISPATCH_FAILED: {exc}"[:500]
            ifc_job.retriable = True
            ifc_job.error_kind = "dispatch"
            logger.warning("Worker dispatch failed for %s: %s", row.storage_key, exc)
            await session.flush()

        await audit.record(
            session,
            action="project_file.completed",
            resource_type="project_file",
            resource_id=row.id,
            after={
                "file_type": "ifc",
                "original_filename": row.original_filename,
                "version_number": row.version_number,
                "ifc_schema": row.ifc_schema.value if row.ifc_schema else None,
            },
            actor_user_id=user.id,
            project_id=project.id,
            request=request,
        )

        await session.refresh(row)
        return row

    row.status = ProjectFileStatus.rejected
    row.rejection_reason = rejection_reason or "UNKNOWN"
    try:
        await storage.delete_object(row.storage_key)
    except Exception:
        logger.warning(
            "Failed to delete rejected upload %s; row marked rejected anyway",
            row.storage_key,
            exc_info=True,
        )
    await audit.record(
        session,
        action="project_file.rejected",
        resource_type="project_file",
        resource_id=row.id,
        after={
            "rejection_reason": row.rejection_reason,
            "file_type": "ifc",
        },
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    await session.flush()
    await session.refresh(row)
    return row


@router.post("/{file_id}/retry-extraction", response_model=ProjectFileRead)
async def retry_extraction(
    project_id: UUID,
    model_id: UUID,
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
    model = await _load_model_or_404(session, project.id, model_id)

    row = await _load_file_or_404(session, model.id, file_id)
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
