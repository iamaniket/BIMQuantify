import asyncio
import contextlib
import secrets
from datetime import UTC, date, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
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
from fastapi_users.password import PasswordHelper
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.access import (
    get_membership,
    is_org_admin,
    load_project_or_404,
    require_member_manager,
    require_member_viewer,
    require_project_owner_or_admin,
    require_project_read_access,
    require_project_writable,
    require_project_write_access,
)
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.guards import is_guest_member
from bimstitch_api.auth.manager import UserManager, get_user_manager
from bimstitch_api.auth.permissions import Action
from bimstitch_api.cache import CACHE_TTL_PROJECT_DETAIL, CACHE_TTL_PROJECT_LIST, cache_response
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.db import get_session_maker
from bimstitch_api.email.invites import (
    send_project_added_notification,
    send_project_invite_notification,
)
from bimstitch_api.i18n.request import attach_notice
from bimstitch_api.jurisdictions import find_instrument, supported_countries
from bimstitch_api.jurisdictions import get as get_jurisdiction
from bimstitch_api.models.contractor import Contractor
from bimstitch_api.models.organization import Organization
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.project import (
    ConsequenceClass,
    Project,
    ProjectLifecycleState,
)
from bimstitch_api.models.project_member import ProjectMember, ProjectRole
from bimstitch_api.models.user import User
from bimstitch_api.pagination import (
    SortParams,
    apply_sort,
    sort_params,
)
from bimstitch_api.schemas.project import (
    ProjectCreate,
    ProjectInvitationCreate,
    ProjectInvitationResponse,
    ProjectMemberCreate,
    ProjectMemberRead,
    ProjectMemberUpdate,
    ProjectRead,
    ProjectUpdate,
)
from bimstitch_api.storage import StorageBackend, get_storage
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects", tags=["projects"])

_THUMBNAIL_KEY_PREFIX = "thumbnails/"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _resolve_thumbnail_url(thumbnail_url: str | None, storage: StorageBackend) -> str | None:
    """Return a presigned GET URL when thumbnail_url is an S3 key; passthrough otherwise."""
    if thumbnail_url is None:
        return None
    if thumbnail_url.startswith(_THUMBNAIL_KEY_PREFIX):
        return await storage.presigned_get_url(thumbnail_url, "thumbnail", disposition="inline")
    return thumbnail_url


async def _project_to_read(
    project: Project,
    storage: StorageBackend,
    my_role: ProjectRole | None = None,
) -> dict[str, object]:
    """Serialize a Project ORM object to a dict with the thumbnail URL resolved
    and the linked contractor's name denormalized into `contractor_name`.

    `my_role` is the requesting caller's role on this project (or None when they
    reach it via an admin bypass rather than a membership row); it is surfaced so
    the portal can gate its UI against the permission matrix.
    """
    data: dict[str, object] = ProjectRead.model_validate(project).model_dump()
    data["thumbnail_url"] = await _resolve_thumbnail_url(project.thumbnail_url, storage)
    data["contractor_name"] = project.contractor.name if project.contractor is not None else None
    data["my_role"] = my_role.value if my_role is not None else None
    return data


def _serialize_field(v: object) -> object:
    """Serialize a model-field value to a JSON-safe scalar for audit log snapshots."""
    if hasattr(v, "value"):  # enum
        return v.value
    if isinstance(v, date):  # covers datetime too (datetime subclasses date)
        return v.isoformat()
    return v


def _validate_country(country: str | None) -> None:
    """422 if the country has no registered jurisdiction. The data layer
    accepts any 2-letter code; this check enforces that the app can actually
    serve the project (compliance, locale, address-format) before persisting."""
    if country is None:
        return
    if country.upper() not in supported_countries():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"UNSUPPORTED_COUNTRY: '{country}' is not a registered jurisdiction",
        )


def _validate_consequence_class(
    consequence_class: ConsequenceClass | None, country: str | None
) -> None:
    """422 if the consequence class is not in the country's allowed scope.
    NL Wkb only certifies Gk1 (CC1) today; declaring CC2/CC3 for an NL
    project is a domain error, not a UI quirk."""
    if consequence_class is None or country is None:
        return
    jurisdiction = get_jurisdiction(country)
    if jurisdiction is None:
        return  # _validate_country surfaces this case separately
    if consequence_class.value not in jurisdiction.allowed_consequence_classes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"CONSEQUENCE_CLASS_OUT_OF_SCOPE: '{consequence_class.value}' is "
                f"not in scope for country '{country}'"
            ),
        )


def _validate_instrument(instrument_id: str | None, country: str | None) -> None:
    """422 if the instrument id isn't registered for the project's country.
    The instrument list is hand-maintained per jurisdiction (NL: TloKB)."""
    if instrument_id is None or country is None:
        return
    if find_instrument(country, instrument_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"INSTRUMENT_NOT_REGISTERED: '{instrument_id}' is not a "
                f"toegelaten instrument for country '{country}'"
            ),
        )


async def _validate_contractor_exists(session: AsyncSession, contractor_id: UUID | None) -> None:
    """Surface a 400 if the contractor isn't in the current tenant schema.
    Cross-tenant isolation is enforced by the schema namespace itself —
    contractors in another org's schema are inaccessible to this session,
    so a non-matching id just returns nothing.
    """
    if contractor_id is None:
        return
    found = (
        await session.execute(select(Contractor.id).where(Contractor.id == contractor_id))
    ).scalar_one_or_none()
    if found is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CONTRACTOR_NOT_FOUND")


async def _member_to_read(session: AsyncSession, member: ProjectMember) -> dict[str, object]:
    """Serialize a ProjectMember row with the user's email/full_name joined in
    from `public.users` so the portal can render the row without a second
    lookup per member.
    """
    row = (
        await session.execute(select(User.email, User.full_name).where(User.id == member.user_id))
    ).first()
    email = row.email if row is not None else ""
    full_name = row.full_name if row is not None else None
    return {
        "project_id": member.project_id,
        "user_id": member.user_id,
        "role": member.role,
        "created_at": member.created_at,
        "email": email,
        "full_name": full_name,
    }


async def _seed_project_members(
    session: AsyncSession,
    project_id: UUID,
    owner_user_id: UUID,
    organization_id: UUID,
) -> None:
    """Seed default members on project creation.

    Creator is owner; active org admins are editors.
    """
    session.add(ProjectMember(project_id=project_id, user_id=owner_user_id, role=ProjectRole.owner))

    admin_user_ids = (
        (
            await session.execute(
                select(OrganizationMember.user_id).where(
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.status == OrganizationMemberStatus.active,
                    OrganizationMember.is_org_admin.is_(True),
                    OrganizationMember.user_id != owner_user_id,
                )
            )
        )
        .scalars()
        .all()
    )

    for admin_user_id in admin_user_ids:
        session.add(
            ProjectMember(
                project_id=project_id,
                user_id=admin_user_id,
                role=ProjectRole.editor,
            )
        )


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
    _validate_consequence_class(payload.consequence_class, payload.country)
    _validate_instrument(payload.instrument_id, payload.country)
    await _validate_contractor_exists(session, payload.contractor_id)

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

    from bimstitch_api.deadlines.compute import recompute_deadlines

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
            "consequence_class": project.consequence_class.value
            if project.consequence_class
            else None,
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

    from bimstitch_api.deadlines.compute import recompute_deadlines

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
    if "consequence_class" in updates:
        # Re-validate against the (possibly new) country; falls back to the
        # existing project.country if the patch doesn't touch it.
        target_country = updates.get("country", project.country)
        _validate_consequence_class(payload.consequence_class, target_country)
    if "instrument_id" in updates:
        target_country = updates.get("country", project.country)
        _validate_instrument(updates["instrument_id"], target_country)
    if "contractor_id" in updates:
        await _validate_contractor_exists(session, updates["contractor_id"])
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
        from bimstitch_api.deadlines.compute import recompute_deadlines

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


# ---------------------------------------------------------------------------
# Membership management
# ---------------------------------------------------------------------------


@router.get("/{project_id}/members", response_model=list[ProjectMemberRead])
async def list_members(
    project_id: UUID,
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort: SortParams = Depends(sort_params),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[dict[str, object]]:
    """List members of a project. Visible to project members, org admins, and
    super-admins. Non-member non-admins get a 404 to keep existence-leakage
    closed."""
    project = await load_project_or_404(session, project_id)
    await require_member_viewer(session, project.id, user, active_org_id)

    total = (
        await session.scalar(
            select(func.count())
            .select_from(ProjectMember)
            .where(ProjectMember.project_id == project.id)
        )
    ) or 0
    response.headers["X-Total-Count"] = str(total)

    base = (
        select(ProjectMember, User.email, User.full_name)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project.id)
    )
    stmt = apply_sort(
        base,
        sort,
        {
            "email": User.email,
            "full_name": User.full_name,
            "role": ProjectMember.role,
            "created_at": ProjectMember.created_at,
        },
        default="created_at",
        default_dir="asc",
        tiebreaker=ProjectMember.user_id,
    ).limit(limit).offset(offset)
    rows = (await session.execute(stmt)).all()
    return [
        {
            "project_id": member.project_id,
            "user_id": member.user_id,
            "role": member.role,
            "created_at": member.created_at,
            "email": email,
            "full_name": full_name,
        }
        for member, email, full_name in rows
    ]


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    project_id: UUID,
    payload: ProjectMemberCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> dict[str, object]:
    project = await load_project_or_404(session, project_id)
    await require_member_manager(session, project.id, user, active_org_id)
    require_project_writable(project)

    if payload.role is ProjectRole.owner:
        # No second-owner. The partial unique index would also catch this, but
        # rejecting up-front gives a clearer error.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_ROLE_NOT_ASSIGNABLE"
        )

    # Same-org invariant: the target user must have an active membership in
    # the current org. We can read `organization_members` even from a tenant
    # session because master tables fall through search_path to `public`,
    # and RLS on `organization_members` is scoped via `app.current_org_id`
    # which `get_tenant_session` already set.
    membership_exists = (
        await session.execute(
            select(OrganizationMember.id).where(
                OrganizationMember.user_id == payload.user_id,
                OrganizationMember.organization_id == active_org_id,
                OrganizationMember.status == OrganizationMemberStatus.active,
            )
        )
    ).scalar_one_or_none()
    if membership_exists is None:
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
    await audit.record(
        session,
        action="project_member.added",
        resource_type="project_member",
        resource_id=project.id,
        after={"user_id": str(payload.user_id), "role": payload.role.value},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return await _member_to_read(session, member)


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    project_id: UUID,
    user_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await load_project_or_404(session, project_id)
    await require_member_manager(session, project.id, user, active_org_id)
    require_project_writable(project)

    target = await get_membership(session, project.id, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MEMBER_NOT_FOUND")
    if target.role is ProjectRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_NOT_REMOVABLE")

    before = {"user_id": str(user_id), "role": target.role.value}
    await session.delete(target)
    await session.flush()
    await audit.record(
        session,
        action="project_member.removed",
        resource_type="project_member",
        resource_id=project.id,
        before=before,
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{project_id}/members/{user_id}", response_model=ProjectMemberRead)
async def update_member_role(
    project_id: UUID,
    user_id: UUID,
    payload: ProjectMemberUpdate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> dict[str, object]:
    project = await load_project_or_404(session, project_id)
    await require_member_manager(session, project.id, user, active_org_id)
    require_project_writable(project)

    target = await get_membership(session, project.id, user_id)
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

    old_role = target.role
    target.role = payload.role
    await session.flush()
    await session.refresh(target)
    await audit.record(
        session,
        action="project_member.role_changed",
        resource_type="project_member",
        resource_id=project.id,
        before={"user_id": str(user_id), "role": old_role.value},
        after={"user_id": str(user_id), "role": payload.role.value},
        actor_user_id=user.id,
        project_id=project.id,
        request=request,
    )
    return await _member_to_read(session, target)


# ---------------------------------------------------------------------------
# Project-scoped invitations
# ---------------------------------------------------------------------------


@router.post(
    "/{project_id}/invitations",
    response_model=ProjectInvitationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_to_project(
    project_id: UUID,
    payload: ProjectInvitationCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    user_manager: UserManager = Depends(get_user_manager),
) -> ProjectInvitationResponse:
    project = await load_project_or_404(session, project_id)
    await require_member_manager(session, project.id, user, active_org_id)
    require_project_writable(project)

    if payload.role is ProjectRole.owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="OWNER_ROLE_NOT_ASSIGNABLE"
        )

    sm = get_session_maker()
    async with sm() as ms:
        org = await ms.get(Organization, active_org_id)
        if org is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ORG_NOT_FOUND")
        schema = org.schema_name

        # Find existing user (case-insensitive).
        normalized = payload.email.strip().lower()
        existing_user = (
            await ms.execute(select(User).where(func.lower(User.email) == normalized))
        ).scalar_one_or_none()

        # Check existing org membership.
        existing_member: OrganizationMember | None = None
        if existing_user is not None:
            existing_member = (
                await ms.execute(
                    select(OrganizationMember).where(
                        OrganizationMember.user_id == existing_user.id,
                        OrganizationMember.organization_id == active_org_id,
                    )
                )
            ).scalar_one_or_none()

        # Branch on scenario.
        scenario: str
        target_user: User

        if existing_user is None:
            # Scenario 1: brand-new user.
            target_user = User(
                email=payload.email,
                hashed_password=PasswordHelper().hash(secrets.token_hex(32)),
                full_name=payload.full_name,
                is_active=True,
                is_verified=False,
                is_superuser=False,
            )
            ms.add(target_user)
            await ms.flush()

            member = OrganizationMember(
                user_id=target_user.id,
                organization_id=active_org_id,
                is_org_admin=False,
                is_guest=True,
                status=OrganizationMemberStatus.pending,
                invited_by=user.id,
            )
            ms.add(member)
            await ms.flush()
            scenario = "new_user"

        elif existing_member is None or existing_member.status == OrganizationMemberStatus.removed:
            # Scenario 2: user exists but not in this org (or was removed).
            target_user = existing_user
            if existing_member is not None:
                existing_member.status = OrganizationMemberStatus.pending
                existing_member.is_org_admin = False
                existing_member.is_guest = True
                existing_member.invited_at = datetime.now(UTC)
                existing_member.invited_by = user.id
                existing_member.accepted_at = None
            else:
                member = OrganizationMember(
                    user_id=target_user.id,
                    organization_id=active_org_id,
                    is_org_admin=False,
                    is_guest=True,
                    status=OrganizationMemberStatus.pending,
                    invited_by=user.id,
                )
                ms.add(member)
                await ms.flush()
            scenario = "new_org_member"

        elif existing_member.status == OrganizationMemberStatus.active:
            # Scenario 3: already an active org member.
            target_user = existing_user
            scenario = "existing_org_member"

        else:
            # Pending or suspended — tell them there's already a pending invite.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="ORG_INVITE_ALREADY_PENDING",
            )

        # Insert project_members row in the tenant schema.
        await ms.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        try:
            await ms.execute(
                text(
                    "INSERT INTO project_members (project_id, user_id, role) "
                    "VALUES (:pid, :uid, :role)"
                ),
                {
                    "pid": str(project.id),
                    "uid": str(target_user.id),
                    "role": payload.role.value,
                },
            )
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="MEMBER_ALREADY_EXISTS"
            ) from exc
        await ms.execute(text("SET LOCAL search_path = public"))

        await audit.record_for_org(
            ms,
            active_org_id,
            action="project_invitation.created",
            resource_type="project_member",
            resource_id=str(project.id),
            after={
                "email": target_user.email,
                "user_id": str(target_user.id),
                "role": payload.role.value,
                "scenario": scenario,
            },
            actor_user_id=user.id,
            project_id=project.id,
            request=request,
        )
        await ms.commit()

    # In-app notification (best-effort, after commit).
    from bimstitch_api.i18n import resolve_org_locale, t
    from bimstitch_api.models.notification import NotificationEventType
    from bimstitch_api.notifications.service import emit_notification_for_org

    # Project-scoped — use the project's jurisdiction default locale.
    locale = resolve_org_locale(project.country)
    await emit_notification_for_org(
        organization_id=active_org_id,
        event_type=NotificationEventType.invitation_sent,
        title=t("notifications.project_member_invited.title", locale),
        body=t(
            "notifications.project_member_invited.body",
            locale,
            invitee_email=target_user.email,
            project_name=project.name,
        ),
        project_id=project.id,
    )

    # Send email AFTER commit so a flaky transport doesn't roll back the invite.
    if scenario == "new_user":
        await user_manager.request_verify(target_user, request)
    elif scenario == "new_org_member":
        await send_project_invite_notification(
            invitee=target_user,
            organization=org,
            project_name=project.name,
            inviter_email=user.email,
        )
    else:
        await send_project_added_notification(
            member=target_user,
            project_name=project.name,
            inviter_email=user.email,
        )

    return ProjectInvitationResponse(
        email=target_user.email,
        role=payload.role,
        project_id=project.id,
        scenario=scenario,
        user_id=target_user.id,
    )
