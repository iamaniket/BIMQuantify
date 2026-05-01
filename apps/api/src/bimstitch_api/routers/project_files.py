"""Endpoints for uploading, listing, downloading and deleting IFC files.

Two-phase upload: the browser calls `initiate` to receive a presigned PUT URL,
PUTs raw bytes directly to the object store, and then calls `complete` so the
API can validate the file's STEP/IFC header and flip the row to `ready`.

Files are nested under a Model (which is itself nested under a Project). Each
upload is a new version of its model; `version_number` is assigned at
`initiate` time as `MAX(version_number) + 1` per model.
"""

import logging
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.extraction import ExtractionDispatchError, dispatch_extraction
from bimstitch_api.ifc.header import parse_ifc_header
from bimstitch_api.models.project_file import (
    ALLOWED_EXTENSIONS,
    ExtractionStatus,
    FileType,
    ProjectFile,
    ProjectFileStatus,
)
from bimstitch_api.models.project_member import ProjectRole
from bimstitch_api.models.user import User
from bimstitch_api.routers.models import _load_model_or_404
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_role,
)
from bimstitch_api.schemas.project_file import (
    InitiateUploadRequest,
    InitiateUploadResponse,
    ProjectFileDownloadResponse,
    ProjectFileRead,
    ViewerBundleResponse,
)
from bimstitch_api.storage import StorageBackend, get_storage
from bimstitch_api.storage.minio import ObjectNotFoundError
from bimstitch_api.tenancy import get_tenant_session

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/models/{model_id}/files",
    tags=["project-files"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


HEADER_PEEK_BYTES = 2048


async def _load_file_or_404(session: AsyncSession, model_id: UUID, file_id: UUID) -> ProjectFile:
    row = (
        await session.execute(
            select(ProjectFile).where(
                ProjectFile.id == file_id,
                ProjectFile.model_id == model_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_FOUND")
    return row


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/initiate",
    response_model=InitiateUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def initiate_upload(
    project_id: UUID,
    model_id: UUID,
    payload: InitiateUploadRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> InitiateUploadResponse:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)

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
        model_id=model.id,
        version_number=new_version,
        uploaded_by_user_id=user.id,
        storage_key=storage_key,
        original_filename=payload.filename,
        size_bytes=payload.size_bytes,
        content_type=payload.content_type,
        file_type=file_type,
        status=ProjectFileStatus.pending,
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        # Concurrent initiate raced us to the same version_number. The unique
        # constraint catches it; surface as 409 so the caller can retry.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="VERSION_NUMBER_CONFLICT"
        ) from exc
    await session.refresh(row)

    upload_url = await storage.presigned_put_url(
        storage_key, payload.content_type, payload.size_bytes
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
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ProjectFile:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)

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
            await session.flush()
            await session.refresh(row)
            return row

        row.status = ProjectFileStatus.ready
        await session.flush()
        await session.refresh(row)
        return row

    # IFC path
    range_end = min(HEADER_PEEK_BYTES - 1, max(row.size_bytes - 1, 0))
    head_bytes = await storage.get_object_range(row.storage_key, 0, range_end)
    result = parse_ifc_header(head_bytes)

    if result.rejection is None and result.schema is not None:
        row.ifc_schema = result.schema
        row.status = ProjectFileStatus.ready
        row.extraction_status = ExtractionStatus.queued
        await session.flush()

        try:
            await dispatch_extraction(row.id, project.id, row.storage_key, settings)
        except ExtractionDispatchError as exc:
            row.extraction_status = ExtractionStatus.failed
            row.extraction_error = f"DISPATCH_FAILED: {exc}"[:500]
            logger.warning("Extractor dispatch failed for %s: %s", row.storage_key, exc)
            await session.flush()

        await session.refresh(row)
        return row

    row.status = ProjectFileStatus.rejected
    row.rejection_reason = result.rejection.value if result.rejection else "UNKNOWN"
    row.ifc_schema = result.schema
    try:
        await storage.delete_object(row.storage_key)
    except Exception:
        logger.warning(
            "Failed to delete rejected upload %s; row marked rejected anyway",
            row.storage_key,
            exc_info=True,
        )
    await session.flush()
    await session.refresh(row)
    return row


@router.get("", response_model=list[ProjectFileRead])
async def list_files(
    project_id: UUID,
    model_id: UUID,
    status_filter: Annotated[Literal["ready", "all"], Query(alias="status")] = "ready",
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> list[ProjectFile]:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)
    model = await _load_model_or_404(session, project.id, model_id)

    stmt = select(ProjectFile).where(ProjectFile.model_id == model.id)
    if status_filter == "ready":
        stmt = stmt.where(ProjectFile.status == ProjectFileStatus.ready)
    stmt = stmt.order_by(ProjectFile.version_number.desc())
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/{file_id}/download", response_model=ProjectFileDownloadResponse)
async def get_download_url(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectFileDownloadResponse:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)
    model = await _load_model_or_404(session, project.id, model_id)

    row = await _load_file_or_404(session, model.id, file_id)
    if row.status is not ProjectFileStatus.ready:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_READY")

    download_url = await storage.presigned_get_url(row.storage_key, row.original_filename)
    return ProjectFileDownloadResponse(download_url=download_url, expires_in=storage.presign_ttl)


@router.post("/{file_id}/retry-extraction", response_model=ProjectFileRead)
async def retry_extraction(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    settings: Settings = Depends(get_settings),
) -> ProjectFile:
    """Re-dispatch extraction for a file whose previous attempt failed.

    Only valid when the row is `status=ready` and `extraction_status=failed`.
    Resets the extraction fields to `queued` and posts to the extractor;
    the same DISPATCH_FAILED guard applies if the extractor is unreachable.
    """
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    model = await _load_model_or_404(session, project.id, model_id)

    row = await _load_file_or_404(session, model.id, file_id)
    if row.status is not ProjectFileStatus.ready:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="FILE_NOT_READY")
    if row.extraction_status is not ExtractionStatus.failed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="EXTRACTION_NOT_FAILED")

    row.extraction_status = ExtractionStatus.queued
    row.extraction_error = None
    row.extraction_started_at = None
    row.extraction_finished_at = None
    await session.flush()

    try:
        await dispatch_extraction(row.id, project.id, row.storage_key, settings)
    except ExtractionDispatchError as exc:
        row.extraction_status = ExtractionStatus.failed
        row.extraction_error = f"DISPATCH_FAILED: {exc}"[:500]
        logger.warning("Extractor re-dispatch failed for %s: %s", row.storage_key, exc)
        await session.flush()

    await session.refresh(row)
    return row


@router.get("/{file_id}/viewer-bundle", response_model=ViewerBundleResponse)
async def get_viewer_bundle(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> ViewerBundleResponse:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)
    model = await _load_model_or_404(session, project.id, model_id)

    row = await _load_file_or_404(session, model.id, file_id)

    if row.file_type == FileType.pdf:
        if row.status is not ProjectFileStatus.ready:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="VIEWER_BUNDLE_NOT_READY"
            )
        file_url = await storage.presigned_get_url(row.storage_key, row.original_filename)
        return ViewerBundleResponse(
            file_type=row.file_type,
            file_url=file_url,
            expires_in=storage.presign_ttl,
        )

    # IFC path
    if row.extraction_status is not ExtractionStatus.succeeded or row.fragments_storage_key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIEWER_BUNDLE_NOT_READY")

    fragments_url = await storage.presigned_get_url(
        row.fragments_storage_key, f"{row.original_filename}.frag"
    )
    metadata_url: str | None = None
    if row.metadata_storage_key is not None:
        metadata_url = await storage.presigned_get_url(row.metadata_storage_key, "metadata.json")
    properties_url: str | None = None
    if row.properties_storage_key is not None:
        properties_url = await storage.presigned_get_url(
            row.properties_storage_key, "properties.json"
        )

    return ViewerBundleResponse(
        file_type=row.file_type,
        fragments_url=fragments_url,
        metadata_url=metadata_url,
        properties_url=properties_url,
        expires_in=storage.presign_ttl,
    )


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    model = await _load_model_or_404(session, project.id, model_id)

    row = await _load_file_or_404(session, model.id, file_id)
    try:
        await storage.delete_object(row.storage_key)
    except ObjectNotFoundError:
        pass
    except Exception:
        logger.warning(
            "Failed to delete object %s during file delete; proceeding with row delete",
            row.storage_key,
            exc_info=True,
        )

    await session.delete(row)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
