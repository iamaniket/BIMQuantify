"""Endpoints for uploading, listing, downloading and deleting IFC files.

Two-phase upload: the browser calls `initiate` to receive a presigned PUT URL,
PUTs raw bytes directly to the object store, and then calls `complete` so the
API can validate the file's STEP/IFC header and flip the row to `ready`.

Files are nested under a Model (which is itself nested under a Project). Each
upload is a new version of its model; `version_number` is assigned at
`initiate` time as `MAX(version_number) + 1` per model.
"""

import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.access import (
    load_project_or_404,
    require_project_read_access,
)
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.models.model import Model
from bimstitch_api.models.project_file import (
    ExtractionStatus,
    FileType,
    ProjectFile,
    ProjectFileRole,
)
from bimstitch_api.models.user import User
from bimstitch_api.schemas.project_file import (
    ProjectViewerManifestResponse,
    ProjectViewerModelEntry,
)
from bimstitch_api.storage import StorageBackend, get_storage
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

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


async def _presign_ifc_bundle(
    row: ProjectFile, storage: StorageBackend
) -> dict[str, str | None]:
    """Presign the IFC artifact set for one extraction-succeeded file.

    Returns a dict keyed fragments_url / metadata_url / properties_url /
    outline_url / floor_plans_url; artifacts that don't exist (pre-outline
    extractions, MEP models with no floor plan, graceful degrade) map to None.
    The caller guarantees the row is an IFC file with a fragments key. All
    present artifacts are presigned concurrently. Shared by the single-file
    viewer bundle and the project-level federated manifest.
    """
    assert row.fragments_storage_key is not None  # caller-guaranteed (IFC path)
    specs: list[tuple[str, str, str]] = [
        ("fragments_url", row.fragments_storage_key, f"{row.original_filename}.frag"),
    ]
    if row.metadata_storage_key is not None:
        specs.append(("metadata_url", row.metadata_storage_key, "metadata.json"))
    if row.properties_storage_key is not None:
        specs.append(("properties_url", row.properties_storage_key, "properties.json"))
    if row.outline_storage_key is not None:
        specs.append(("outline_url", row.outline_storage_key, "outline.bin"))
    if row.floor_plans_storage_key is not None:
        specs.append(("floor_plans_url", row.floor_plans_storage_key, "floor-plans.bin"))
    urls = await asyncio.gather(
        *(storage.presigned_get_url(key, name) for _, key, name in specs)
    )
    out: dict[str, str | None] = {
        "fragments_url": None,
        "metadata_url": None,
        "properties_url": None,
        "outline_url": None,
        "floor_plans_url": None,
    }
    for (field, _key, _name), url in zip(specs, urls, strict=True):
        out[field] = url
    return out


# ---------------------------------------------------------------------------
# Project-level federated viewer manifest
# ---------------------------------------------------------------------------
# Project-scoped (one prefix up from the per-file router) so the federated
# viewer can load every discipline model of a project in one request.
project_viewer_router = APIRouter(prefix="/projects/{project_id}", tags=["project-files"])


@project_viewer_router.get("/viewer-bundle", response_model=ProjectViewerManifestResponse)
async def get_project_viewer_bundle(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectViewerManifestResponse:
    """Federated viewer manifest: the latest ready, extraction-succeeded IFC
    file for every (non-deleted) model in the project, each with presigned
    artifact URLs. Powers the multi-discipline viewer — load all entries into
    one scene, toggle each on/off, and source the 2D floor plan from the
    `detected_kind == 'architectural'` entry. Models with no ready IFC file are
    omitted.
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    # Two sequential reads (AsyncSession forbids concurrent queries), then a
    # single concurrent presign fan-out (storage calls only, no DB).
    models = list(
        (
            await session.execute(
                select(Model)
                .where(Model.project_id == project.id, Model.deleted_at.is_(None))
                .order_by(Model.created_at)
            )
        )
        .scalars()
        .all()
    )
    if not models:
        return ProjectViewerManifestResponse(expires_in=storage.presign_ttl, models=[])

    model_by_id = {m.id: m for m in models}
    rows = (
        (
            await session.execute(
                select(ProjectFile)
                .where(
                    ProjectFile.model_id.in_(list(model_by_id.keys())),
                    ProjectFile.role == ProjectFileRole.model_source,
                    ProjectFile.file_type == FileType.ifc,
                    ProjectFile.extraction_status == ExtractionStatus.succeeded,
                    ProjectFile.fragments_storage_key.is_not(None),
                    ProjectFile.deleted_at.is_(None),
                )
                # Version-desc within each model so the first row seen per model
                # is its current (latest) viewable version.
                .order_by(ProjectFile.model_id, ProjectFile.version_number.desc())
            )
        )
        .scalars()
        .all()
    )
    latest_by_model: dict[UUID, ProjectFile] = {}
    for row in rows:
        if row.model_id is None or row.model_id in latest_by_model:
            continue
        latest_by_model[row.model_id] = row

    # Preserve model creation order; drop models with no ready IFC file.
    chosen = [
        (model_by_id[m.id], latest_by_model[m.id])
        for m in models
        if m.id in latest_by_model
    ]
    bundles = await asyncio.gather(
        *(_presign_ifc_bundle(row, storage) for _model, row in chosen)
    )
    entries = [
        ProjectViewerModelEntry(
            file_id=row.id,
            model_id=model.id,
            model_name=model.name,
            discipline=model.discipline,
            detected_kind=row.detected_kind,
            fragments_url=bundle["fragments_url"],
            fragments_key=row.fragments_storage_key,
            metadata_url=bundle["metadata_url"],
            properties_url=bundle["properties_url"],
            outline_url=bundle["outline_url"],
            floor_plans_url=bundle["floor_plans_url"],
        )
        for (model, row), bundle in zip(chosen, bundles, strict=True)
    ]
    return ProjectViewerManifestResponse(expires_in=storage.presign_ttl, models=entries)
