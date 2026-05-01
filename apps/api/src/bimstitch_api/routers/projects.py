from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.models.contractor import Contractor
from bimstitch_api.models.project import Project, ProjectLifecycleState
from bimstitch_api.models.project_member import ProjectMember, ProjectRole
from bimstitch_api.models.user import User
from bimstitch_api.schemas.project import (
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberRead,
    ProjectMemberUpdate,
    ProjectRead,
    ProjectUpdate,
)
from bimstitch_api.storage import StorageBackend, get_storage
from bimstitch_api.tenancy import get_tenant_session

router = APIRouter(prefix="/projects", tags=["projects"])

_THUMBNAIL_KEY_PREFIX = "thumbnails/"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _resolve_thumbnail_url(
    thumbnail_url: str | None, storage: StorageBackend
) -> str | None:
    """Return a presigned GET URL when thumbnail_url is an S3 key; passthrough otherwise."""
    if thumbnail_url is None:
        return None
    if thumbnail_url.startswith(_THUMBNAIL_KEY_PREFIX):
        return await storage.presigned_get_url(thumbnail_url, "thumbnail")
    return thumbnail_url


async def _project_to_read(project: Project, storage: StorageBackend) -> dict[str, object]:
    """Serialize a Project ORM object to a dict with the thumbnail URL resolved
    and the linked contractor's name denormalized into `contractor_name`."""
    data: dict[str, object] = ProjectRead.model_validate(project).model_dump()
    data["thumbnail_url"] = await _resolve_thumbnail_url(project.thumbnail_url, storage)
    data["contractor_name"] = project.contractor.name if project.contractor is not None else None
    return data


async def _validate_contractor_belongs_to_org(
    session: AsyncSession, contractor_id: UUID | None, organization_id: UUID
) -> None:
    """RLS already filters across orgs, but a non-matching contractor_id resolves
    to None — surface that as a 400 with a clear error so the caller knows the
    FK is invalid in their tenant context."""
    if contractor_id is None:
        return
    found = (
        await session.execute(
            select(Contractor.id).where(
                Contractor.id == contractor_id,
                Contractor.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="CONTRACTOR_NOT_FOUND"
        )


async def _load_project_or_404(session: AsyncSession, project_id: UUID) -> Project:
    """Loads a project the current tenant can see (RLS-filtered). 404 if not."""
    project = (
        await session.execute(select(Project).where(Project.id == project_id))
    ).scalar_one_or_none()
    if project is None or project.lifecycle_state is ProjectLifecycleState.removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PROJECT_NOT_FOUND")
    return project


async def _get_membership(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> ProjectMember | None:
    return (
        await session.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def _require_membership(
    session: AsyncSession, project_id: UUID, user_id: UUID
) -> ProjectMember:
    """Returns the caller's membership; raises 404 if not a member. The 404
    keeps existence-leakage closed for same-org-non-member."""
    membership = await _get_membership(session, project_id, user_id)
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PROJECT_NOT_FOUND")
    return membership


def _require_role(membership: ProjectMember, *allowed: ProjectRole) -> None:
    if membership.role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="INSUFFICIENT_PROJECT_ROLE"
        )


def _require_project_writable(project: Project) -> None:
    if project.lifecycle_state is ProjectLifecycleState.archived:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="PROJECT_ARCHIVED",
        )


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    await _validate_contractor_belongs_to_org(
        session, payload.contractor_id, user.organization_id
    )

    project = Project(
        organization_id=user.organization_id,
        owner_id=user.id,
        **payload.model_dump(),
    )
    session.add(project)
    try:
        await session.flush()
    except IntegrityError as exc:
        # Could be name OR reference_code uniqueness; surface both via shared
        # CONFLICT code — clients distinguish by inspecting which field they sent.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PROJECT_NAME_CONFLICT"
        ) from exc

    session.add(ProjectMember(project_id=project.id, user_id=user.id, role=ProjectRole.owner))
    await session.flush()
    await session.refresh(project)
    return await _project_to_read(project, storage)


@router.post("/with-thumbnail", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project_with_thumbnail(
    name: Annotated[str, Form(min_length=1, max_length=255)],
    description: Annotated[str | None, Form()] = None,
    thumbnail: Annotated[UploadFile | None, File()] = None,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """Create a project with an optional thumbnail image (multipart/form-data).

    Thumbnail rules:
    - Max size: THUMBNAIL_MAX_BYTES (default 2 MB)
    - Allowed types: THUMBNAIL_ALLOWED_CONTENT_TYPES (default JPEG, PNG, WebP)
    """
    thumbnail_key: str | None = None

    if thumbnail is not None and thumbnail.filename:
        allowed_types = [
            t.strip() for t in settings.thumbnail_allowed_content_types.split(",")
        ]
        content_type = thumbnail.content_type or ""
        if content_type not in allowed_types:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="THUMBNAIL_UNSUPPORTED_TYPE",
            )

        data = await thumbnail.read()
        if len(data) > settings.thumbnail_max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="THUMBNAIL_TOO_LARGE",
            )

        ext = content_type.split("/")[-1].replace("jpeg", "jpg")
        thumbnail_key = f"{_THUMBNAIL_KEY_PREFIX}{uuid4()}.{ext}"
        await storage.put_object(thumbnail_key, content_type, data)

    project = Project(
        organization_id=user.organization_id,
        name=name,
        description=description if description else None,
        thumbnail_url=thumbnail_key,
        owner_id=user.id,
    )
    session.add(project)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PROJECT_NAME_CONFLICT"
        ) from exc

    session.add(ProjectMember(project_id=project.id, user_id=user.id, role=ProjectRole.owner))
    await session.flush()
    await session.refresh(project)
    return await _project_to_read(project, storage)


@router.get("", response_model=list[ProjectRead])
async def list_projects(
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> list[dict[str, object]]:
    stmt = (
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(Project.lifecycle_state != ProjectLifecycleState.removed)
        .where(ProjectMember.user_id == user.id)
        .order_by(Project.created_at)
    )
    result = await session.execute(stmt)
    projects = list(result.scalars().all())
    return [await _project_to_read(p, storage) for p in projects]


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)
    return await _project_to_read(project, storage)


@router.patch("/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner, ProjectRole.editor)
    _require_project_writable(project)

    updates = payload.model_dump(exclude_unset=True)
    if "contractor_id" in updates:
        await _validate_contractor_belongs_to_org(
            session, updates["contractor_id"], project.organization_id
        )
    for field, value in updates.items():
        setattr(project, field, value)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PROJECT_NAME_CONFLICT"
        ) from exc
    await session.refresh(project)
    return await _project_to_read(project, storage)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner)

    project.lifecycle_state = ProjectLifecycleState.removed
    await session.flush()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{project_id}/archive", response_model=ProjectRead)
async def archive_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner)

    if project.lifecycle_state is ProjectLifecycleState.archived:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="PROJECT_ARCHIVED")

    project.lifecycle_state = ProjectLifecycleState.archived
    await session.flush()
    await session.refresh(project)
    return await _project_to_read(project, storage)


@router.post("/{project_id}/reactivate", response_model=ProjectRead)
async def reactivate_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    _require_role(membership, ProjectRole.owner)

    if project.lifecycle_state is not ProjectLifecycleState.archived:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="PROJECT_NOT_ARCHIVED",
        )

    project.lifecycle_state = ProjectLifecycleState.active
    await session.flush()
    await session.refresh(project)
    return await _project_to_read(project, storage)


# ---------------------------------------------------------------------------
# Membership management
# ---------------------------------------------------------------------------


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    project_id: UUID,
    payload: ProjectMemberCreate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> ProjectMember:
    project = await _load_project_or_404(session, project_id)
    caller = await _require_membership(session, project.id, user.id)
    _require_role(caller, ProjectRole.owner)
    _require_project_writable(project)

    if payload.role is ProjectRole.owner:
        # No second-owner. The partial unique index would also catch this, but
        # rejecting up-front gives a clearer error.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_ROLE_NOT_ASSIGNABLE"
        )

    # Same-org invariant. RLS prevents reading users from other orgs, so a
    # cross-org user_id resolves to None here — surface as a 400, not 404, so
    # the caller knows the user exists conceptually but not in their tenant.
    target_org = (
        await session.execute(select(User.organization_id).where(User.id == payload.user_id))
    ).scalar_one_or_none()
    if target_org is None or target_org != project.organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="USER_NOT_IN_PROJECT_ORG"
        )

    member = ProjectMember(project_id=project.id, user_id=payload.user_id, role=payload.role)
    session.add(member)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="MEMBER_ALREADY_EXISTS"
        ) from exc
    await session.refresh(member)
    return member


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    project_id: UUID,
    user_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    caller = await _require_membership(session, project.id, user.id)
    _require_role(caller, ProjectRole.owner)
    _require_project_writable(project)

    target = await _get_membership(session, project.id, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MEMBER_NOT_FOUND")
    if target.role is ProjectRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_NOT_REMOVABLE")

    await session.delete(target)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{project_id}/members/{user_id}", response_model=ProjectMemberRead)
async def update_member_role(
    project_id: UUID,
    user_id: UUID,
    payload: ProjectMemberUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> ProjectMember:
    project = await _load_project_or_404(session, project_id)
    caller = await _require_membership(session, project.id, user.id)
    _require_role(caller, ProjectRole.owner)
    _require_project_writable(project)

    target = await _get_membership(session, project.id, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MEMBER_NOT_FOUND")

    # No transferring or demoting the owner this iteration.
    if target.role is ProjectRole.owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_ROLE_NOT_CHANGEABLE"
        )
    if payload.role is ProjectRole.owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_ROLE_NOT_ASSIGNABLE"
        )

    target.role = payload.role
    await session.flush()
    await session.refresh(target)
    return target
