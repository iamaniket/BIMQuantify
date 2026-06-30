"""Read/delete endpoints: list, download URL, viewer bundle, delete.

The endpoints here are decorated with the per-file `router` imported from
`._shared`; importing this module registers them.
"""

import asyncio
import base64
import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.models.project_file import (
    ExtractionStatus,
    FileType,
    ProjectFile,
    ProjectFileStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.routers.documents import _load_document_or_404
from bimdossier_api.routers.free_access import require_free_tier_enabled
from bimdossier_api.routers.project_files._shared import (
    _load_file_or_404,
    _presign_ifc_bundle,
    logger,
    router,
)
from bimdossier_api.schemas.project_file import (
    ProjectFileDownloadResponse,
    ProjectFileRead,
    ViewerBundleResponse,
)
from bimdossier_api.storage import StorageBackend, get_storage
from bimdossier_api.storage.minio import ObjectNotFoundError
from bimdossier_api.tenancy import (
    ScopeContext,
    get_scope_context,
    get_scoped_session,
    get_tenant_session,
    open_tenant_session,
    require_active_organization,
)

# The processor's page-image manifest is small (one entry per page, a few KB even
# for a large set); cap the read so a corrupt/huge object can't be slurped whole.
_PDF_PAGES_MANIFEST_MAX_BYTES = 8 * 1024 * 1024


async def _build_pdf_pages_manifest_url(storage: StorageBackend, manifest_key: str) -> str | None:
    """Rewrite the processor's page-image manifest into the shape the mobile
    viewer's ``ImageRasterSource`` consumes, and return it as a ``data:`` URL.

    The processor writes each page entry with a raw S3 ``key`` (it cannot mint a
    presigned URL — those would expire long before the viewer opens). The viewer,
    however, reads a fetchable ``url`` and fetches it auth-free from inside the
    WebView. So here — at viewer-bundle time, where presigning belongs — we read
    the manifest, presign every page ``key`` into a ``url``, and inline the
    rewritten manifest as a ``data:`` URL. Inlining keeps the existing
    ``pdf_pages_url`` field + the WebView's ``fetch(url)`` / ``RasterSource.open(url)``
    contract intact, and avoids re-uploading a manifest full of expiring URLs.

    Returns ``None`` when the manifest object is missing or unreadable (the viewer
    then reports "no 2D view" rather than rendering blank pages).
    """
    try:
        raw = await storage.get_object_range(manifest_key, 0, _PDF_PAGES_MANIFEST_MAX_BYTES - 1)
    except ObjectNotFoundError:
        return None
    try:
        manifest = json.loads(raw)
        source_pages = manifest["pages"]
    except (ValueError, TypeError, KeyError):
        logger.warning("Unreadable PDF pages manifest %s", manifest_key, exc_info=True)
        return None

    async def _entry(page: dict[str, object]) -> dict[str, object]:
        # Presigned, fetchable url replaces the raw key; geometry is preserved.
        url = await storage.presigned_get_url(str(page["key"]), "page.webp", disposition="inline")
        return {
            "index": page.get("index"),
            "pageWidth": page.get("pageWidth"),
            "pageHeight": page.get("pageHeight"),
            "imageWidth": page.get("imageWidth"),
            "imageHeight": page.get("imageHeight"),
            "url": url,
        }

    pages = await asyncio.gather(
        *[_entry(p) for p in source_pages if isinstance(p, dict) and p.get("key")]
    )
    encoded = base64.b64encode(json.dumps({"v": 1, "pages": pages}).encode()).decode("ascii")
    return f"data:application/json;base64,{encoded}"


@router.get("", response_model=list[ProjectFileRead])
async def list_files(
    project_id: UUID,
    document_id: UUID,
    response: Response,
    status_filter: Annotated[Literal["ready", "all"], Query(alias="status")] = "ready",
    # Generous cap: the portal lists all versions/files for a document (no paging).
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[ProjectFile]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    document = await _load_document_or_404(session, project.id, document_id)

    base = select(ProjectFile).where(ProjectFile.document_id == document.id)
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
    document_id: UUID,
    file_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectFileDownloadResponse:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    document = await _load_document_or_404(session, project.id, document_id)

    row = await _load_file_or_404(session, document.id, file_id)
    if row.status is not ProjectFileStatus.ready:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_READY")

    download_url = await storage.presigned_get_url(row.storage_key, row.original_filename)
    return ProjectFileDownloadResponse(download_url=download_url, expires_in=storage.presign_ttl)


@router.get("/{file_id}/viewer-bundle", response_model=ViewerBundleResponse)
async def get_viewer_bundle(
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    session: AsyncSession = Depends(get_scoped_session),
    scope: ScopeContext = Depends(get_scope_context),
    storage: StorageBackend = Depends(get_storage),
) -> ViewerBundleResponse:
    if scope.is_free:
        require_free_tier_enabled()
        # Local import avoids any import-order cycle (free_documents deferred-imports
        # project_files.access). The free helper reads the pooled free_* tables; the
        # legacy /free/.../files/{id}/viewer-bundle route serves the same logic.
        from bimdossier_api.routers import free_documents

        return await free_documents.free_file_viewer_bundle(
            project_id=project_id,
            document_id=document_id,
            file_id=file_id,
            user=scope.user,
            session=session,
            storage=storage,
        )

    user = scope.user
    assert scope.org_id is not None
    active_org_id = scope.org_id
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    document = await _load_document_or_404(session, project.id, document_id)

    row = await _load_file_or_404(session, document.id, file_id)

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
        # Server-rasterized page-image manifest for the mobile pdfjs-free viewer.
        # Rewrite it (presign each page key → url) and inline as a data: URL so
        # the WebView's auth-free fetch gets pages it can actually load.
        pdf_pages_url: str | None = None
        if row.pdf_pages_storage_key is not None:
            pdf_pages_url = await _build_pdf_pages_manifest_url(storage, row.pdf_pages_storage_key)
        return ViewerBundleResponse(
            file_type=row.file_type,
            file_url=file_url,
            geometry_url=geometry_url,
            pdf_pages_url=pdf_pages_url,
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
    document_id: UUID,
    file_id: UUID,
    request: Request,
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> Response:
    """Delete a file version. The S3 delete is network I/O and runs with NO
    tenant DB connection held (Phase 2) so a slow object store can't pin a
    pooled connection — the same discipline as routers/compliance.py."""
    schema: str = request.state.active_schema

    # --- Phase 1: validate + snapshot the values Phases 2/3 need.
    async with open_tenant_session(schema, active_org_id, user.id) as session:
        project = await load_project_or_404(session, project_id)
        membership = await require_membership(session, project.id, user.id)
        require_permission(membership.role, Resource.project_file, Action.delete)
        require_project_writable(project)
        document = await _load_document_or_404(session, project.id, document_id)
        row = await _load_file_or_404(session, document.id, file_id)
        storage_key = row.storage_key
        before = {
            "original_filename": row.original_filename,
            "file_type": row.file_type.value,
            "version_number": row.version_number,
        }
        project_uuid = project.id

    # --- Phase 2: delete the stored object with no connection held.
    try:
        await storage.delete_object(storage_key)
    except ObjectNotFoundError:
        pass
    except Exception:
        logger.warning(
            "Failed to delete object %s during file delete; proceeding with row delete",
            storage_key,
            exc_info=True,
        )

    # --- Phase 3: audit + delete the row in a fresh short transaction.
    async with open_tenant_session(schema, active_org_id, user.id) as session:
        document = await _load_document_or_404(session, project_uuid, document_id)
        row = await _load_file_or_404(session, document.id, file_id)
        await audit.record(
            session,
            action="project_file.deleted",
            resource_type="project_file",
            resource_id=row.id,
            before=before,
            actor_user_id=user.id,
            project_id=project_uuid,
            request=request,
        )
        await session.delete(row)
        await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
