"""CRUD endpoints for Document — a user-defined grouping of IFC versions.

Documents are nested under projects. Each document belongs to exactly one
project, and a project can have many documents. ProjectFile rows attach to a
document and carry a `version_number` so a document has an ordered history of
IFC uploads.

Authorization mirrors projects: any project member can read; owner/editor can
mutate; owner only can delete.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimdossier_api import audit
from bimdossier_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.cache import (
    CACHE_TTL_DOCUMENT_DETAIL,
    CACHE_TTL_DOCUMENTS_LIST,
    cache_response,
)
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.jobs.lifecycle import rerun_ifc_extraction
from bimdossier_api.models.document import Document, DocumentDiscipline, DocumentStatus
from bimdossier_api.models.levels import Level
from bimdossier_api.models.project_file import (
    ExtractionStatus,
    FileType,
    ProjectFile,
    ProjectFileStatus,
)
from bimdossier_api.routers import pooled_documents
from bimdossier_api.routers.free_access import require_free_tier_enabled
from bimdossier_api.schemas.document import (
    DocumentCreate,
    DocumentRead,
    DocumentUpdate,
    DocumentWithVersions,
)
from bimdossier_api.storage import StorageBackend, get_storage
from bimdossier_api.storage.minio import ObjectNotFoundError
from bimdossier_api.tenancy import ScopeContext, get_scope_context, get_scoped_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])


async def _load_document_or_404(
    session: AsyncSession, project_id: UUID, document_id: UUID
) -> Document:
    """Load a document the current tenant can see, scoped to the given project."""
    document = (
        await session.execute(
            select(Document).where(Document.id == document_id, Document.project_id == project_id)
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DOCUMENT_NOT_FOUND")
    return document


def _plan_intent(discipline: DocumentDiscipline) -> str:
    """Whether a declared discipline forces the floor-plan cut on/off, or defers
    to content auto-detection. Mirrors the processor gate
    (classify.ts::shouldGenerateFloorPlan) and is used to decide whether a
    discipline change actually flips the outcome (so we only re-extract then):
    architectural/coordination → "on", structural/mep → "off", other → "auto".
    """
    if discipline in (DocumentDiscipline.architectural, DocumentDiscipline.coordination):
        return "on"
    if discipline in (DocumentDiscipline.structural, DocumentDiscipline.mep):
        return "off"
    return "auto"


@router.post("", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
async def create_document(
    project_id: UUID,
    payload: DocumentCreate,
    request: Request,
    session: AsyncSession = Depends(get_scoped_session),
    scope: ScopeContext = Depends(get_scope_context),
    settings: Settings = Depends(get_settings),
) -> Document | DocumentRead:
    if scope.is_free:
        require_free_tier_enabled()
        return await pooled_documents.create_pooled_document(
            session=session,
            user=scope.user,
            project_id=project_id,
            payload=pooled_documents.PooledDocumentCreate(**payload.model_dump()),
            settings=settings,
        )

    user = scope.user
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.document, Action.create)
    require_project_writable(project)

    document = Document(
        project_id=project.id,
        name=payload.name,
        discipline=payload.discipline,
        status=payload.status,
    )
    session.add(document)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="DOCUMENT_NAME_CONFLICT"
        ) from exc
    await session.refresh(document)

    await audit.record(
        session,
        action="document.created",
        resource_type="document",
        resource_id=document.id,
        after={
            "name": document.name,
            "discipline": document.discipline.value if document.discipline else None,
            "status": document.status.value,
            "primary_file_type": (
                document.primary_file_type.value if document.primary_file_type else None
            ),
        },
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    return document


@router.get("")
async def list_documents(
    project_id: UUID,
    response: Response,
    session: AsyncSession = Depends(get_scoped_session),
    scope: ScopeContext = Depends(get_scope_context),
    status_filter: DocumentStatus | None = Query(default=None, alias="status"),
    discipline: DocumentDiscipline | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    include: str | None = Query(default=None),
) -> list[dict[str, object]]:
    if scope.is_free:
        require_free_tier_enabled()
        # Free always returns the with-versions shape (the free client never asks
        # for the light list); status/discipline/paging filters are paid-only.
        docs = await pooled_documents.list_pooled_project_documents(session, project_id)
        response.headers["X-Total-Count"] = str(len(docs))
        return [d.model_dump() for d in docs]

    user = scope.user
    assert scope.org_id is not None
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, scope.org_id)

    stmt = select(Document).where(Document.project_id == project.id)
    if status_filter is not None:
        stmt = stmt.where(Document.status == status_filter)
    if discipline is not None:
        stmt = stmt.where(Document.discipline == discipline)

    total = (await session.scalar(select(func.count()).select_from(stmt.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)

    if include == "versions":
        stmt = stmt.options(selectinload(Document.files))

    stmt = stmt.order_by(Document.created_at).limit(limit).offset(offset)
    result = await session.execute(stmt)
    documents = list(result.scalars().all())
    cache_response(response, CACHE_TTL_DOCUMENTS_LIST)

    if include == "versions":
        return [
            DocumentWithVersions.model_validate(
                {
                    "id": m.id,
                    "project_id": m.project_id,
                    "name": m.name,
                    "discipline": m.discipline,
                    "status": m.status,
                    "primary_file_type": m.primary_file_type,
                    "level_id": m.level_id,
                    "head_file_id": m.head_file_id,
                    "created_at": m.created_at,
                    "updated_at": m.updated_at,
                    "versions": list(m.files),
                }
            ).model_dump()
            for m in documents
        ]

    return [DocumentRead.model_validate(m).model_dump() for m in documents]


@router.get("/{document_id}", response_model=DocumentWithVersions)
async def get_document(
    project_id: UUID,
    document_id: UUID,
    response: Response,
    session: AsyncSession = Depends(get_scoped_session),
    scope: ScopeContext = Depends(get_scope_context),
) -> dict[str, object]:
    if scope.is_free:
        require_free_tier_enabled()
        doc = await pooled_documents.get_pooled_document(session, project_id, document_id)
        return doc.model_dump()

    user = scope.user
    assert scope.org_id is not None
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, scope.org_id)

    document = (
        await session.execute(
            select(Document)
            .where(Document.id == document_id, Document.project_id == project.id)
            .options(selectinload(Document.files))
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DOCUMENT_NOT_FOUND")

    cache_response(response, CACHE_TTL_DOCUMENT_DETAIL)
    data: dict[str, object] = DocumentWithVersions.model_validate(
        {
            **{
                "id": document.id,
                "project_id": document.project_id,
                "name": document.name,
                "discipline": document.discipline,
                "status": document.status,
                "primary_file_type": document.primary_file_type,
                "level_id": document.level_id,
                "head_file_id": document.head_file_id,
                "created_at": document.created_at,
                "updated_at": document.updated_at,
            },
            "versions": list(document.files),
        }
    ).model_dump()
    return data


@router.patch("/{document_id}", response_model=DocumentRead)
async def update_document(
    project_id: UUID,
    document_id: UUID,
    payload: DocumentUpdate,
    request: Request,
    session: AsyncSession = Depends(get_scoped_session),
    scope: ScopeContext = Depends(get_scope_context),
    settings: Settings = Depends(get_settings),
) -> Document | DocumentRead:
    if scope.is_free:
        require_free_tier_enabled()
        return await pooled_documents.update_pooled_document(
            session=session,
            user=scope.user,
            project_id=project_id,
            document_id=document_id,
            payload=pooled_documents.PooledDocumentUpdate(**payload.model_dump(exclude_unset=True)),
        )

    user = scope.user
    assert scope.org_id is not None
    active_org_id = scope.org_id
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.document, Action.update)
    require_project_writable(project)

    document = await _load_document_or_404(session, project.id, document_id)
    old_discipline = document.discipline

    updates = payload.model_dump(exclude_unset=True)

    # Level assignment guard: a level is for 2D drawings only, and must belong to
    # this project. NULL detaches (-> Unassigned) and is always allowed.
    if updates.get("level_id") is not None:
        if document.primary_file_type is FileType.ifc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="DOCUMENT_LEVEL_NOT_FOR_IFC",
            )
        level = (
            await session.execute(
                select(Level).where(
                    Level.id == updates["level_id"],
                    Level.project_id == project.id,
                    Level.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if level is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="LEVEL_NOT_FOUND"
            )

    def _snap(attr: object) -> object:
        if hasattr(attr, "value"):
            return attr.value
        if isinstance(attr, UUID):
            return str(attr)  # JSONB audit payload must be JSON-serializable
        return attr

    before = {k: _snap(getattr(document, k)) for k in updates}
    for field, value in updates.items():
        setattr(document, field, value)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="DOCUMENT_NAME_CONFLICT"
        ) from exc
    await session.refresh(document)

    after = {k: _snap(getattr(document, k)) for k in updates}
    await audit.record(
        session,
        action="document.updated",
        resource_type="document",
        resource_id=document.id,
        before=before,
        after=after,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    # A discipline change can flip the floor-plan outcome — the processor reads
    # the declared discipline at extraction time, and the 2D artifact is only
    # (re)built by re-extracting. When the change flips plan intent (on/off/auto)
    # for an IFC document, re-run extraction on the effective head version so the
    # plan appears or disappears to match.
    if (
        "discipline" in updates
        and document.primary_file_type is FileType.ifc
        and _plan_intent(old_discipline) != _plan_intent(document.discipline)
    ):
        versions = (
            (
                await session.execute(
                    select(ProjectFile)
                    .where(
                        ProjectFile.document_id == document.id,
                        ProjectFile.status == ProjectFileStatus.ready,
                        ProjectFile.extraction_status == ExtractionStatus.succeeded,
                        ProjectFile.file_type == FileType.ifc,
                        ProjectFile.deleted_at.is_(None),
                    )
                    .order_by(ProjectFile.version_number.desc())
                )
            )
            .scalars()
            .all()
        )
        # Local import breaks a module-load cycle: project_files/__init__ imports
        # upload.py, which imports this module's _load_document_or_404, so importing
        # project_files._shared at documents.py load time forms a circular import
        # (see git history / prelaunch review). Deferred to call time — no cost after
        # first import (module is cached in sys.modules).
        from bimdossier_api.routers.project_files._shared import resolve_head_file_id

        head_id = resolve_head_file_id(document, list(versions))
        head = next((v for v in versions if v.id == head_id), None)
        if head is not None:
            try:
                await rerun_ifc_extraction(
                    session,
                    head,
                    settings=settings,
                    organization_id=active_org_id,
                    user=user,
                    discipline=document.discipline.value,
                )
            except HTTPException as exc:
                # At the org job limit — keep the discipline change; the user can
                # re-extract later. Any other error propagates.
                if exc.status_code != status.HTTP_429_TOO_MANY_REQUESTS:
                    raise
                logger.warning(
                    "Re-extraction after discipline change skipped (job limit) for document %s",
                    document.id,
                )

    return document


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    project_id: UUID,
    document_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_scoped_session),
    scope: ScopeContext = Depends(get_scope_context),
    storage: StorageBackend = Depends(get_storage),
) -> Response:
    if scope.is_free:
        require_free_tier_enabled()
        await pooled_documents.delete_pooled_document(
            user=scope.user,
            project_id=project_id,
            document_id=document_id,
            storage=storage,
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    user = scope.user
    project = await load_project_or_404(session, project_id)
    membership = await require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.document, Action.delete)
    require_project_writable(project)

    document = await _load_document_or_404(session, project.id, document_id)
    before = {
        "name": document.name,
        "discipline": document.discipline.value if document.discipline else None,
        "status": document.status.value,
        "primary_file_type": (
            document.primary_file_type.value if document.primary_file_type else None
        ),
    }

    storage_keys = [
        key
        for (key,) in (
            await session.execute(
                select(ProjectFile.storage_key).where(ProjectFile.document_id == document.id)
            )
        ).all()
    ]

    await audit.record(
        session,
        action="document.deleted",
        resource_type="document",
        resource_id=document.id,
        before=before,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )

    await session.delete(document)
    await session.flush()

    for key in storage_keys:
        try:
            await storage.delete_object(key)
        except ObjectNotFoundError:
            pass
        except Exception:
            logger.warning(
                "Failed to delete object %s during document delete; row was removed",
                key,
                exc_info=True,
            )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
