"""Read/delete endpoints: list, download URL, viewer bundle, delete.

The endpoints here are decorated with the per-file `router` imported from
`._shared`; importing this module registers them.
"""

import asyncio
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.models.project_file import (
    ExtractionStatus,
    FileType,
    ProjectFile,
    ProjectFileStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.routers.models import _load_model_or_404
from bimstitch_api.routers.project_files._shared import (
    logger,
    router,
    _load_file_or_404,
    _presign_ifc_bundle,
)
from bimstitch_api.schemas.project_file import (
    ProjectFileDownloadResponse,
    ProjectFileRead,
    ViewerBundleResponse,
)
from bimstitch_api.storage import StorageBackend, get_storage
from bimstitch_api.storage.minio import ObjectNotFoundError
from bimstitch_api.tenancy import get_tenant_session, require_active_organization


@router.get("", response_model=list[ProjectFileRead])
async def list_files(
    project_id: UUID,
    model_id: UUID,
    response: Response,
    status_filter: Annotated[Literal["ready", "all"], Query(alias="status")] = "ready",
    # Generous cap: the portal lists all versions/files for a model (no paging).
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[ProjectFile]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    model = await _load_model_or_404(session, project.id, model_id)

    base = select(ProjectFile).where(ProjectFile.model_id == model.id)
    if status_filter == "ready":
        base = base.where(ProjectFile.status == ProjectFileStatus.ready)
    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)
    result = await session.execute(
        base.order_by(ProjectFile.version_number.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all())


@router.get("/{file_id}/download", response_model=ProjectFileDownloadResponse)
async def get_download_url(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectFileDownloadResponse:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    model = await _load_model_or_404(session, project.id, model_id)

    row = await _load_file_or_404(session, model.id, file_id)
    if row.status is not ProjectFileStatus.ready:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_READY")

    download_url = await storage.presigned_get_url(row.storage_key, row.original_filename)
    return ProjectFileDownloadResponse(download_url=download_url, expires_in=storage.presign_ttl)


@router.get("/{file_id}/viewer-bundle", response_model=ViewerBundleResponse)
async def get_viewer_bundle(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> ViewerBundleResponse:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    model = await _load_model_or_404(session, project.id, model_id)

    row = await _load_file_or_404(session, model.id, file_id)

    if row.file_type == FileType.pdf:
        if row.status is not ProjectFileStatus.ready:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="VIEWER_BUNDLE_NOT_READY"
            )
        file_url = await storage.presigned_get_url(row.storage_key, row.original_filename)
        geometry_url: str | None = None
        if row.geometry_storage_key is not None:
            geometry_url = await storage.presigned_get_url(
                row.geometry_storage_key, "geometry.json"
            )
        return ViewerBundleResponse(
            file_type=row.file_type,
            file_url=file_url,
            geometry_url=geometry_url,
            expires_in=storage.presign_ttl,
        )

    if row.file_type in (FileType.dxf, FileType.dwg):
        # Drawing path: the overlay renders the geometry artifact; the info
        # panel reads the metadata blob. file_url lets the user grab the raw CAD.
        if (
            row.extraction_status is not ExtractionStatus.succeeded
            or row.geometry_storage_key is None
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="VIEWER_BUNDLE_NOT_READY"
            )
        geometry_key = row.geometry_storage_key
        cad_coros = [
            storage.presigned_get_url(geometry_key, "geometry.json"),
            storage.presigned_get_url(row.storage_key, row.original_filename),
        ]
        cad_metadata_key = row.metadata_storage_key
        if cad_metadata_key is not None:
            cad_coros.append(storage.presigned_get_url(cad_metadata_key, "metadata.json"))
        cad_urls = await asyncio.gather(*cad_coros)
        return ViewerBundleResponse(
            file_type=row.file_type,
            geometry_url=cad_urls[0],
            file_url=cad_urls[1],
            metadata_url=cad_urls[2] if cad_metadata_key is not None else None,
            expires_in=storage.presign_ttl,
        )

    # IFC path
    if row.extraction_status is not ExtractionStatus.succeeded or row.fragments_storage_key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIEWER_BUNDLE_NOT_READY")

    bundle = await _presign_ifc_bundle(row, storage)
    return ViewerBundleResponse(
        file_type=row.file_type,
        fragments_url=bundle["fragments_url"],
        fragments_key=row.fragments_storage_key,
        metadata_url=bundle["metadata_url"],
        properties_url=bundle["properties_url"],
        outline_url=bundle["outline_url"],
        floor_plans_url=bundle["floor_plans_url"],
        expires_in=storage.presign_ttl,
    )


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> Response:
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.project_file, Action.delete)
    require_project_writable(project)
    model = await _load_model_or_404(session, project.id, model_id)

    row = await _load_file_or_404(session, model.id, file_id)
    before = {
        "original_filename": row.original_filename,
        "file_type": row.file_type.value,
        "version_number": row.version_number,
    }

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

    await audit.record(
        session,
        action="project_file.deleted",
        resource_type="project_file",
        resource_id=row.id,
        before=before,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    await session.delete(row)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
