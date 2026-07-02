from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy import text as sql_text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.background.locks import lock_id_for
from bimdossier_api.config import Settings
from bimdossier_api.models.pooled_document import PooledDocument
from bimdossier_api.models.pooled_level import PooledLevel
from bimdossier_api.models.pooled_project_file import PooledProjectFile
from bimdossier_api.models.user import User
from bimdossier_api.routers.free_access import (
    assert_can_create_free_content,
    assert_pooled_project_owned,
)
from bimdossier_api.routers.pooled._shared import (
    PooledDocumentCreate,
    PooledDocumentUpdate,
    _document_to_read,
    _document_to_with_versions,
    _load_accessible_document_or_404,
    _load_owned_document_or_404,
)
from bimdossier_api.schemas.document import DocumentRead, DocumentWithVersions
from bimdossier_api.storage import StorageBackend
from bimdossier_api.storage.scoping import pooled_key_prefix
from bimdossier_api.tenancy import open_pooled_session

# ---------------------------------------------------------------------------
# Document CRUD
# ---------------------------------------------------------------------------


async def create_pooled_document(
    session: AsyncSession,
    user: User,
    project_id: UUID,
    payload: PooledDocumentCreate,
    settings: Settings,
) -> DocumentRead:
    """Free-tier container create. Called from the unified documents router's free
    branch (routers/documents.py::create_document) — no longer a route itself."""
    # Create-gate: only org-less users (trial still open) may create free CONTENT;
    # only the project owner may add containers to it. Returns effective caps.
    limits = await assert_can_create_free_content(user)
    await assert_pooled_project_owned(session, project_id, user.id)
    # Serialize this user's concurrent creates so the per-user container cap can't
    # be TOCTOU-raced (transaction-scoped; released at commit).
    await session.execute(
        sql_text("SELECT pg_advisory_xact_lock(:k)"),
        {"k": lock_id_for(f"pooled_doc:{user.id}")},
    )
    existing = (
        await session.scalar(
            select(func.count())
            .select_from(PooledDocument)
            .where(
                PooledDocument.owner_user_id == user.id,
                PooledDocument.deleted_at.is_(None),
            )
        )
    ) or 0
    if existing >= limits.max_documents:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="FREE_MODEL_CAP_REACHED")

    document = PooledDocument(
        owner_user_id=user.id,
        pooled_project_id=project_id,
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


async def list_pooled_project_documents(
    session: AsyncSession,
    project_id: UUID,
) -> list[DocumentWithVersions]:
    """Free-tier container list (always with versions). Called from the unified
    documents router's free branch."""
    # Participant-readable: RLS scopes visibility to owner + shared-project members.
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
        return []
    files = list(
        (
            await session.execute(
                select(PooledProjectFile)
                .where(
                    PooledProjectFile.pooled_document_id.in_([d.id for d in documents]),
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
    files_by_doc: dict[UUID, list[PooledProjectFile]] = {}
    for f in files:
        files_by_doc.setdefault(f.pooled_document_id, []).append(f)
    return [_document_to_with_versions(d, files_by_doc.get(d.id, [])) for d in documents]


async def get_pooled_document(
    session: AsyncSession,
    project_id: UUID,
    document_id: UUID,
) -> DocumentWithVersions:
    """Free-tier container detail (with versions). Called from the unified
    documents router's free branch."""
    document = await _load_accessible_document_or_404(session, project_id, document_id)
    files = list(
        (
            await session.execute(
                select(PooledProjectFile)
                .where(
                    PooledProjectFile.pooled_document_id == document_id,
                    PooledProjectFile.deleted_at.is_(None),
                )
                .order_by(PooledProjectFile.version_number.desc())
            )
        )
        .scalars()
        .all()
    )
    return _document_to_with_versions(document, files)


async def update_pooled_document(
    session: AsyncSession,
    user: User,
    project_id: UUID,
    document_id: UUID,
    payload: PooledDocumentUpdate,
) -> DocumentRead:
    """Free-tier container update (rename / discipline / status / level). Called
    from the unified documents router's free branch."""
    document = await _load_owned_document_or_404(session, project_id, document_id, user.id)
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
                select(PooledLevel.id).where(
                    PooledLevel.id == new_level_id,
                    PooledLevel.pooled_project_id == project_id,
                    PooledLevel.deleted_at.is_(None),
                )
            )
            if exists is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LEVEL_NOT_FOUND")
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


async def delete_pooled_document(
    user: User,
    project_id: UUID,
    document_id: UUID,
    storage: StorageBackend,
) -> None:
    """Free-tier container delete (+ object cleanup). Opens its own short session.
    Called from the unified documents router's free branch."""
    async with open_pooled_session(user.id) as session:
        document = await _load_owned_document_or_404(session, project_id, document_id, user.id)
        prefix = f"{pooled_key_prefix(user.id)}{document_id}/"
        await session.delete(document)  # cascades pooled_project_files + pooled_findings
    # Storage cleanup after the rows are gone (best-effort; reaper backstops).
    await storage.delete_prefix(prefix)
