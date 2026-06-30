"""Endpoints for uploading, listing, downloading and deleting IFC files.

Two-phase upload: the browser calls `initiate` to receive a presigned PUT URL,
PUTs raw bytes directly to the object store, and then calls `complete` so the
API can validate the file's STEP/IFC header and flip the row to `ready`.

Files are nested under a Document (which is itself nested under a Project). Each
upload is a new version of its document; `version_number` is assigned at
`initiate` time as `MAX(version_number) + 1` per document.
"""

import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.access import (
    load_project_or_404,
    require_project_read_access,
)
from bimdossier_api.models.document import Document
from bimdossier_api.models.project_file import (
    ExtractionStatus,
    FileType,
    ProjectFile,
    ProjectFileRole,
)
from bimdossier_api.routers.free_access import require_free_tier_enabled
from bimdossier_api.schemas.project_file import (
    ProjectViewerDocumentEntry,
    ProjectViewerManifestResponse,
)
from bimdossier_api.storage import StorageBackend, get_storage
from bimdossier_api.tenancy import ScopeContext, get_scope_context, get_scoped_session

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/documents/{document_id}/files",
    tags=["project-files"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


HEADER_PEEK_BYTES = 2048


async def _load_file_or_404(session: AsyncSession, document_id: UUID, file_id: UUID) -> ProjectFile:
    row = (
        await session.execute(
            select(ProjectFile).where(
                ProjectFile.id == file_id,
                ProjectFile.document_id == document_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FILE_NOT_FOUND")
    return row


def resolve_head_file_id(document: Document, candidates_desc: list[ProjectFile]) -> UUID | None:
    """Resolve a document's effective head-file id (F7 restore-version-as-head).

    Returns ``document.head_file_id`` when it is set and still present among
    ``candidates_desc`` (the eligible versions, ordered ``version_number`` desc);
    otherwise the newest candidate's id, falling back to the historical
    "head = highest version" behaviour. ``candidates_desc`` should already be
    filtered to the rows the caller treats as selectable (e.g. ready /
    extraction-succeeded). Returns ``None`` only when there are no candidates.
    """
    if document.head_file_id is not None and any(
        c.id == document.head_file_id for c in candidates_desc
    ):
        return document.head_file_id
    return candidates_desc[0].id if candidates_desc else None


async def _presign_ifc_bundle(row: ProjectFile, storage: StorageBackend) -> dict[str, str | None]:
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
    urls = await asyncio.gather(*(storage.presigned_get_url(key, name) for _, key, name in specs))
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
# viewer can load every discipline document of a project in one request.
project_viewer_router = APIRouter(prefix="/projects/{project_id}", tags=["project-files"])


@project_viewer_router.get("/viewer-bundle", response_model=ProjectViewerManifestResponse)
async def get_project_viewer_bundle(
    project_id: UUID,
    session: AsyncSession = Depends(get_scoped_session),
    scope: ScopeContext = Depends(get_scope_context),
    storage: StorageBackend = Depends(get_storage),
) -> ProjectViewerManifestResponse:
    """Federated viewer manifest: the latest ready, extraction-succeeded IFC
    file for every (non-deleted) document in the project, each with presigned
    artifact URLs. Powers the multi-discipline viewer — load all entries into
    one scene, toggle each on/off, and source the 2D floor plan from the
    `detected_kind == 'architectural'` entry. Documents with no ready IFC file
    are omitted.

    Tier-unified: a free (org-less) caller is served the pooled free manifest via
    the free helper (the legacy `/free/projects/{id}/viewer-bundle` route still
    serves the same logic during migration).
    """
    if scope.is_free:
        require_free_tier_enabled()
        # Local import avoids any import-order cycle (pooled_documents deferred-imports
        # project_files.access). The free helper reads the pooled free_* tables.
        from bimdossier_api.routers import pooled_documents

        return await pooled_documents.pooled_project_viewer_bundle(
            project_id=project_id, user=scope.user, session=session, storage=storage
        )

    user = scope.user
    assert scope.org_id is not None
    active_org_id = scope.org_id
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    # Two sequential reads (AsyncSession forbids concurrent queries), then a
    # single concurrent presign fan-out (storage calls only, no DB).
    documents = list(
        (
            await session.execute(
                select(Document)
                .where(Document.project_id == project.id, Document.deleted_at.is_(None))
                .order_by(Document.created_at)
            )
        )
        .scalars()
        .all()
    )
    if not documents:
        return ProjectViewerManifestResponse(expires_in=storage.presign_ttl, models=[])

    document_by_id = {m.id: m for m in documents}
    rows = (
        (
            await session.execute(
                select(ProjectFile)
                .where(
                    ProjectFile.document_id.in_(list(document_by_id.keys())),
                    ProjectFile.role == ProjectFileRole.model_source,
                    ProjectFile.file_type == FileType.ifc,
                    ProjectFile.extraction_status == ExtractionStatus.succeeded,
                    ProjectFile.fragments_storage_key.is_not(None),
                    ProjectFile.deleted_at.is_(None),
                )
                # Version-desc within each document so the first row seen per
                # document is its current (latest) viewable version.
                .order_by(ProjectFile.document_id, ProjectFile.version_number.desc())
            )
        )
        .scalars()
        .all()
    )
    # Group eligible rows per document (already version-desc), then pick each
    # document's effective head — its `head_file_id` pointer when set, else newest.
    rows_by_document: dict[UUID, list[ProjectFile]] = {}
    for row in rows:
        if row.document_id is None:
            continue
        rows_by_document.setdefault(row.document_id, []).append(row)
    latest_by_document: dict[UUID, ProjectFile] = {}
    for did, group in rows_by_document.items():
        head_id = resolve_head_file_id(document_by_id[did], group)
        head_row = next((r for r in group if r.id == head_id), None)
        if head_row is not None:
            latest_by_document[did] = head_row

    # Preserve document creation order; drop documents with no ready IFC file.
    chosen = [
        (document_by_id[m.id], latest_by_document[m.id])
        for m in documents
        if m.id in latest_by_document
    ]
    bundles = await asyncio.gather(
        *(_presign_ifc_bundle(row, storage) for _document, row in chosen)
    )
    entries = [
        ProjectViewerDocumentEntry(
            file_id=row.id,
            model_id=document.id,
            model_name=document.name,
            discipline=document.discipline,
            detected_kind=row.detected_kind,
            fragments_url=bundle["fragments_url"],
            fragments_key=row.fragments_storage_key,
            metadata_url=bundle["metadata_url"],
            properties_url=bundle["properties_url"],
            outline_url=bundle["outline_url"],
            floor_plans_url=bundle["floor_plans_url"],
        )
        for (document, row), bundle in zip(chosen, bundles, strict=True)
    ]
    return ProjectViewerManifestResponse(expires_in=storage.presign_ttl, models=entries)
