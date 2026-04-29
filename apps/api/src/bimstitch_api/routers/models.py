"""CRUD endpoints for Model — a user-defined grouping of IFC versions.

Models are nested under projects. Each model belongs to exactly one project,
and a project can have many models. ProjectFile rows attach to a model and
carry a `version_number` so a model has an ordered history of IFC uploads.

Authorization mirrors projects: any project member can read; owner/editor can
mutate; owner only can delete.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.models.model import Model, ModelDiscipline, ModelStatus
from bimstitch_api.models.project_file import ProjectFile
from bimstitch_api.models.project_member import ProjectRole
from bimstitch_api.models.user import User
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_role,
)
from bimstitch_api.schemas.model import (
    ModelCreate,
    ModelRead,
    ModelUpdate,
    ModelWithVersions,
)
from bimstitch_api.storage import StorageBackend, get_storage
from bimstitch_api.storage.minio import ObjectNotFoundError
from bimstitch_api.tenancy import get_tenant_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/models", tags=["models"])


async def _load_model_or_404(session: AsyncSession, project_id: UUID, model_id: UUID) -> Model:
    """Load a model the current tenant can see, scoped to the given project."""
    model = (
        await session.execute(
            select(Model).where(Model.id == model_id, Model.project_id == project_id)
        )
    ).scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MODEL_NOT_FOUND")
    return model


@router.post("", response_model=ModelRead, status_code=status.HTTP_201_CREATED)
async def create_model(
    project_id: UUID,
    payload: ModelCreate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Model:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)

    model = Model(
        project_id=project.id,
        name=payload.name,
        discipline=payload.discipline,
        status=payload.status,
    )
    session.add(model)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="MODEL_NAME_CONFLICT"
        ) from exc
    await session.refresh(model)
    return model


@router.get("", response_model=list[ModelRead])
async def list_models(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    status_filter: ModelStatus | None = Query(default=None, alias="status"),
    discipline: ModelDiscipline | None = Query(default=None),
) -> list[Model]:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)

    stmt = select(Model).where(Model.project_id == project.id)
    if status_filter is not None:
        stmt = stmt.where(Model.status == status_filter)
    if discipline is not None:
        stmt = stmt.where(Model.discipline == discipline)
    stmt = stmt.order_by(Model.created_at)
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/{model_id}", response_model=ModelWithVersions)
async def get_model(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> dict[str, object]:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)

    model = (
        await session.execute(
            select(Model)
            .where(Model.id == model_id, Model.project_id == project.id)
            .options(selectinload(Model.files))
        )
    ).scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MODEL_NOT_FOUND")

    data: dict[str, object] = ModelWithVersions.model_validate(
        {
            **{
                "id": model.id,
                "project_id": model.project_id,
                "name": model.name,
                "discipline": model.discipline,
                "status": model.status,
                "created_at": model.created_at,
                "updated_at": model.updated_at,
            },
            "versions": list(model.files),
        }
    ).model_dump()
    return data


@router.patch("/{model_id}", response_model=ModelRead)
async def update_model(
    project_id: UUID,
    model_id: UUID,
    payload: ModelUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Model:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)

    model = await _load_model_or_404(session, project.id, model_id)

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(model, field, value)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="MODEL_NAME_CONFLICT"
        ) from exc
    await session.refresh(model)
    return model


@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner)

    model = await _load_model_or_404(session, project.id, model_id)

    storage_keys = [
        key
        for (key,) in (
            await session.execute(
                select(ProjectFile.storage_key).where(ProjectFile.model_id == model.id)
            )
        ).all()
    ]

    await session.delete(model)
    await session.flush()

    for key in storage_keys:
        try:
            await storage.delete_object(key)
        except ObjectNotFoundError:
            pass
        except Exception:  # noqa: BLE001
            logger.warning(
                "Failed to delete object %s during model delete; row was removed",
                key,
                exc_info=True,
            )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
