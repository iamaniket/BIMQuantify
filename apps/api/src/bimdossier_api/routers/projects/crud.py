import asyncio
import contextlib
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import (
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.access import (
    get_membership,
    is_org_admin,
    load_project_or_404,
    require_project_owner_or_admin,
    require_project_read_access,
    require_project_writable,
    require_project_write_access,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.guards import is_guest_member
from bimdossier_api.auth.permissions import Action
from bimdossier_api.cache import CACHE_TTL_PROJECT_DETAIL, CACHE_TTL_PROJECT_LIST, cache_response
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.i18n.request import attach_notice
from bimdossier_api.models.project import (
    Project,
    ProjectLifecycleState,
)
from bimdossier_api.models.project_member import ProjectMember, ProjectRole
from bimdossier_api.models.user import User
from bimdossier_api.routers.projects._shared import (
    _THUMBNAIL_KEY_PREFIX,
    _project_to_read,
    _seed_project_members,
    _serialize_field,
    _validate_country,
    router,
)
from bimdossier_api.schemas.project import (
    ProjectCreate,
    ProjectRead,
    ProjectUpdate,
)
from bimdossier_api.storage import StorageBackend, get_storage
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    # Cross-org guests cannot create projects in the host org. They were
    # invited to collaborate on specific projects only.
    if not user.is_superuser and await is_guest_member(session, user.id, active_org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="GUEST_CANNOT_CREATE_PROJECT",
        )
    _validate_country(payload.country)

    project = Project(
        owner_id=user.id,
        **payload.model_dump(),
    )
    session.add(project)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PROJECT_NAME_CONFLICT"
        ) from exc

    await _seed_project_members(session, project.id, user.id, active_org_id)
    await session.flush()

    from bimdossier_api.deadlines.compute import recompute_deadlines

    await recompute_deadlines(session, project)

    await session.refresh(project)
    await audit.record(
        session,
        action="project.created",
        resource_type="project",
        resource_id=project.id,
        after={
            "name": project.name,
            "country": project.country,
            "building_type": project.building_type.value if project.building_type else None,
        },
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    attach_notice(response, "PROJECT_CREATED", request, user)
    return await _project_to_read(project, storage, my_role=ProjectRole.owner)


@router.post("/with-thumbnail", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project_with_thumbnail(
    name: Annotated[str, Form(min_length=1, max_length=255)],
    request: Request,
    description: Annotated[str | None, Form()] = None,
    thumbnail: Annotated[UploadFile | None, File()] = None,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """Create a project with an optional thumbnail image (multipart/form-data).

    Thumbnail rules:
    - Max size: THUMBNAIL_MAX_BYTES (default 2 MB)
    - Allowed types: THUMBNAIL_ALLOWED_CONTENT_TYPES (default JPEG, PNG, WebP)
    """
    if not user.is_superuser and await is_guest_member(session, user.id, active_org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="GUEST_CANNOT_CREATE_PROJECT",
        )
    thumbnail_key: str | None = None

    if thumbnail is not None and thumbnail.filename:
        allowed_types = [t.strip() for t in settings.thumbnail_allowed_content_types.split(",")]
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

    await _seed_project_members(session, project.id, user.id, active_org_id)
    await session.flush()

    from bimdossier_api.deadlines.compute import recompute_deadlines

    await recompute_deadlines(session, project)

    await session.refresh(project)
    await audit.record(
        session,
        action="project.created",
        resource_type="project",
        resource_id=project.id,
        after={"name": project.name},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return await _project_to_read(project, storage, my_role=ProjectRole.owner)


@router.post("/{project_id}/thumbnail", response_model=ProjectRead)
async def update_project_thumbnail(
    project_id: UUID,
    thumbnail: Annotated[UploadFile, File()],
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """Upload or replace a project's thumbnail image (multipart/form-data)."""
    project = await load_project_or_404(session, project_id)
    await require_project_write_access(session, project.id, user, active_org_id)
    require_project_writable(project)

    allowed_types = [t.strip() for t in settings.thumbnail_allowed_content_types.split(",")]
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
    new_key = f"{_THUMBNAIL_KEY_PREFIX}{uuid4()}.{ext}"
    await storage.put_object(new_key, content_type, data)

    old_key = project.thumbnail_url
    if old_key is not None and old_key.startswith(_THUMBNAIL_KEY_PREFIX):
        with contextlib.suppress(Exception):
            await storage.delete_object(old_key)

    project.thumbnail_url = new_key
    await session.flush()
    await session.refresh(project)
    await audit.record(
        session,
        action="project.thumbnail_updated",
        resource_type="project",
        resource_id=project.id,
        after={"thumbnail_url": new_key},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return await _project_to_read(project, storage)


@router.get("", response_model=list[ProjectRead])
async def list_projects(
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> list[dict[str, object]]:
    base = select(Project).where(
        Project.lifecycle_state.in_([ProjectLifecycleState.active, ProjectLifecycleState.archived])
    )
    if not user.is_superuser and not await is_org_admin(session, user.id, active_org_id):
        base = base.join(ProjectMember, ProjectMember.project_id == Project.id).where(
            ProjectMember.user_id == user.id
        )

    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = base.order_by(Project.created_at).limit(limit).offset(offset)
    result = await session.execute(stmt)
    projects = list(result.scalars().all())

    # Resolve the caller's own role per project so the portal can gate its UI.
    # One lookup covers both branches: non-admins always have a membership row
    # (that's how they see the project); an admin who isn't a member maps to
    # None and the portal falls back to its org-admin flag.
    role_by_project: dict[UUID, ProjectRole] = {}
    if projects:
        member_rows = await session.execute(
            select(ProjectMember.project_id, ProjectMember.role).where(
                ProjectMember.user_id == user.id,
                ProjectMember.project_id.in_([p.id for p in projects]),
            )
        )
        role_by_project = {pid: role for pid, role in member_rows.all()}

    cache_response(response, CACHE_TTL_PROJECT_LIST)
    return list(
        await asyncio.gather(
            *[_project_to_read(p, storage, my_role=role_by_project.get(p.id)) for p in projects]
        )
    )


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(
    project_id: UUID,
    response: Response,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)
    # `my_role` is the caller's *actual* membership role, fetched independently of
    # the read gate above: an org-admin/superuser reaches the project via the
    # bypass (which returns no membership), yet may still hold a real role here
    # (e.g. the creating org-admin is the owner). Writes are gated on the real
    # role, so this must reflect the row, not the bypass.
    my_membership = await get_membership(session, project.id, user.id)
    cache_response(response, CACHE_TTL_PROJECT_DETAIL)
    return await _project_to_read(
        project, storage, my_role=my_membership.role if my_membership is not None else None
    )


@router.patch("/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await load_project_or_404(session, project_id)
    await require_project_write_access(session, project.id, user, active_org_id)
    require_project_writable(project)

    updates = payload.model_dump(exclude_unset=True)
    if "country" in updates:
        _validate_country(updates["country"])
    if "thumbnail_url" in updates:
        old_key = project.thumbnail_url
        new_val = updates["thumbnail_url"]
        if old_key is not None and old_key.startswith(_THUMBNAIL_KEY_PREFIX) and new_val != old_key:
            with contextlib.suppress(Exception):
                await storage.delete_object(old_key)

    before = {k: _serialize_field(getattr(project, k)) for k in updates}
    for field, value in updates.items():
        setattr(project, field, value)

    if {"planned_start_date", "delivery_date", "country"} & updates.keys():
        from bimdossier_api.deadlines.compute import recompute_deadlines

        await recompute_deadlines(session, project)

    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="PROJECT_NAME_CONFLICT"
        ) from exc
    await session.refresh(project)
    after = {k: _serialize_field(getattr(project, k)) for k in updates}
    await audit.record(
        session,
        action="project.updated",
        resource_type="project",
        resource_id=project.id,
        before=before,
        after=after,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    attach_notice(response, "PROJECT_UPDATED", request, user)
    return await _project_to_read(project, storage)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await load_project_or_404(session, project_id)
    await require_project_owner_or_admin(session, project.id, user, active_org_id)

    before = {"name": project.name, "lifecycle_state": project.lifecycle_state.value}
    project.lifecycle_state = ProjectLifecycleState.removed
    await session.flush()
    await audit.record(
        session,
        action="project.deleted",
        resource_type="project",
        resource_id=project.id,
        before=before,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{project_id}/archive", response_model=ProjectRead)
async def archive_project(
    project_id: UUID,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await load_project_or_404(session, project_id)
    await require_project_owner_or_admin(
        session, project.id, user, active_org_id, action=Action.archive
    )

    if project.lifecycle_state is ProjectLifecycleState.archived:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="PROJECT_ARCHIVED")

    project.lifecycle_state = ProjectLifecycleState.archived
    # TODO(tier-2-archive): Dispatch async job to transition S3 objects to
    # GLACIER/STANDARD_IA, zip project files into a single archive bundle,
    # and move tenant DB rows to shadow tables (no indexes → saves IO/vacuum).
    await session.flush()
    await session.refresh(project)
    await audit.record(
        session,
        action="project.archived",
        resource_type="project",
        resource_id=project.id,
        before={"lifecycle_state": ProjectLifecycleState.active.value},
        after={"lifecycle_state": ProjectLifecycleState.archived.value},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    attach_notice(response, "PROJECT_ARCHIVED", request, user)
    return await _project_to_read(project, storage)


@router.post("/{project_id}/reactivate", response_model=ProjectRead)
async def reactivate_project(
    project_id: UUID,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await load_project_or_404(session, project_id)
    await require_project_owner_or_admin(
        session, project.id, user, active_org_id, action=Action.archive
    )

    if project.lifecycle_state is not ProjectLifecycleState.archived:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="PROJECT_NOT_ARCHIVED",
        )

    project.lifecycle_state = ProjectLifecycleState.active
    # TODO(tier-2-archive): Dispatch async unarchive job — restore S3
    # objects from GLACIER (minutes-to-hours), unzip archive bundle, move
    # rows back from shadow tables, rebuild indexes.  Return a pending
    # status and show "restoring…" in the portal until the worker completes.
    await session.flush()
    await session.refresh(project)
    await audit.record(
        session,
        action="project.reactivated",
        resource_type="project",
        resource_id=project.id,
        before={"lifecycle_state": ProjectLifecycleState.archived.value},
        after={"lifecycle_state": ProjectLifecycleState.active.value},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    attach_notice(response, "PROJECT_REACTIVATED", request, user)
    return await _project_to_read(project, storage)
