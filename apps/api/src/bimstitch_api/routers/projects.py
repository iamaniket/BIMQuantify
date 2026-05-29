import asyncio
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
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.guards import is_guest_member
from bimstitch_api.auth.manager import UserManager, get_user_manager
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.cache import CACHE_TTL_PROJECT_DETAIL, CACHE_TTL_PROJECT_LIST, cache_response
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.db import get_session_maker
from bimstitch_api.email.invites import (
    send_project_added_notification,
    send_project_invite_notification,
)
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
        return await storage.presigned_get_url(thumbnail_url, "thumbnail")
    return thumbnail_url


async def _project_to_read(project: Project, storage: StorageBackend) -> dict[str, object]:
    """Serialize a Project ORM object to a dict with the thumbnail URL resolved
    and the linked contractor's name denormalized into `contractor_name`."""
    data: dict[str, object] = ProjectRead.model_validate(project).model_dump()
    data["thumbnail_url"] = await _resolve_thumbnail_url(project.thumbnail_url, storage)
    data["contractor_name"] = project.contractor.name if project.contractor is not None else None
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


async def _is_org_admin(session: AsyncSession, user_id: UUID, organization_id: UUID) -> bool:
    """True if the user has an active org-admin membership in the active org.

    Safe inside a tenant session: `organization_members` lives in `public` and
    falls through `search_path`; RLS is keyed off `app.current_org_id` which
    `get_tenant_session` already set.
    """
    row = (
        await session.execute(
            select(OrganizationMember.id).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_org_admin.is_(True),
                OrganizationMember.status == OrganizationMemberStatus.active,
            )
        )
    ).scalar_one_or_none()
    return row is not None


async def _require_member_manager(
    session: AsyncSession,
    project_id: UUID,
    user: User,
    organization_id: UUID,
) -> None:
    """Gate for project-member mutations (add/remove/update role).

    Allowed: platform super-admin, org admin in the active org, or the
    project owner. Anyone else → 403. Org admins get this power so a
    departing project owner doesn't leave a project stranded, and so
    onboarding/offboarding can be driven centrally.
    """
    if user.is_superuser:
        return
    if await _is_org_admin(session, user.id, organization_id):
        return
    membership = await _get_membership(session, project_id, user.id)
    if membership is not None and membership.role is ProjectRole.owner:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="INSUFFICIENT_PROJECT_ROLE")


async def _require_project_read_access(
    session: AsyncSession,
    project_id: UUID,
    user: User,
    organization_id: UUID,
) -> ProjectMember | None:
    """Gate for reading project data (detail view, sub-resources).

    Returns the ProjectMember row when the caller is a member, or None
    when access is granted via an admin bypass (superuser or org admin).
    Non-member non-admins get 404 to keep existence-leakage closed.
    """
    if user.is_superuser:
        return None
    if await _is_org_admin(session, user.id, organization_id):
        return None
    return await _require_membership(session, project_id, user.id)


async def _require_project_write_access(
    session: AsyncSession,
    project_id: UUID,
    user: User,
    organization_id: UUID,
) -> None:
    """Gate for updating project data (PATCH).

    Allowed: platform super-admin, org admin in the active org, or a
    project member with owner/editor role.  Non-member non-admins get 404
    to keep existence-leakage closed.
    """
    if user.is_superuser:
        return
    if await _is_org_admin(session, user.id, organization_id):
        return
    membership = await _require_membership(session, project_id, user.id)
    require_permission(membership.role, Resource.project, Action.update)


async def _require_project_owner_or_admin(
    session: AsyncSession,
    project_id: UUID,
    user: User,
    organization_id: UUID,
    *,
    action: Action = Action.delete,
) -> None:
    """Gate for destructive / lifecycle project mutations (delete, archive,
    reactivate).

    Allowed: platform super-admin, org admin in the active org, or the
    project owner.  Editors are excluded — these are heavyweight actions.
    Non-member non-admins get 404.
    """
    if user.is_superuser:
        return
    if await _is_org_admin(session, user.id, organization_id):
        return
    membership = await _require_membership(session, project_id, user.id)
    require_permission(membership.role, Resource.project, action)


async def _require_member_viewer(
    session: AsyncSession,
    project_id: UUID,
    user: User,
    organization_id: UUID,
) -> None:
    """Gate for reading the project member list.

    Allowed: platform super-admin, org admin in the active org, or any
    project member. Anyone else → 404 (mirrors `_require_membership` to
    keep existence-leakage closed).
    """
    if user.is_superuser:
        return
    if await _is_org_admin(session, user.id, organization_id):
        return
    await _require_membership(session, project_id, user.id)


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
    request: Request,
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
            "consequence_class": project.consequence_class.value if project.consequence_class else None,
        },
        actor_user_id=user.id,
        request=request,
    )
    return await _project_to_read(project, storage)


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
    if not user.is_superuser and not await _is_org_admin(session, user.id, active_org_id):
        base = base.join(ProjectMember, ProjectMember.project_id == Project.id).where(
            ProjectMember.user_id == user.id
        )

    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = base.order_by(Project.created_at).limit(limit).offset(offset)
    result = await session.execute(stmt)
    projects = list(result.scalars().all())
    cache_response(response, CACHE_TTL_PROJECT_LIST)
    return list(await asyncio.gather(*[_project_to_read(p, storage) for p in projects]))


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(
    project_id: UUID,
    response: Response,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)
    cache_response(response, CACHE_TTL_PROJECT_DETAIL)
    return await _project_to_read(project, storage)


@router.patch("/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await _load_project_or_404(session, project_id)
    await _require_project_write_access(session, project.id, user, active_org_id)
    _require_project_writable(project)

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
        request=request,
    )
    return await _project_to_read(project, storage)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    project = await _load_project_or_404(session, project_id)
    await _require_project_owner_or_admin(session, project.id, user, active_org_id)

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
        request=request,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{project_id}/archive", response_model=ProjectRead)
async def archive_project(
    project_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await _load_project_or_404(session, project_id)
    await _require_project_owner_or_admin(
        session, project.id, user, active_org_id, action=Action.archive
    )

    if project.lifecycle_state is ProjectLifecycleState.archived:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="PROJECT_ARCHIVED")

    project.lifecycle_state = ProjectLifecycleState.archived
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
        request=request,
    )
    return await _project_to_read(project, storage)


@router.post("/{project_id}/reactivate", response_model=ProjectRead)
async def reactivate_project(
    project_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, object]:
    project = await _load_project_or_404(session, project_id)
    await _require_project_owner_or_admin(
        session, project.id, user, active_org_id, action=Action.archive
    )

    if project.lifecycle_state is not ProjectLifecycleState.archived:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="PROJECT_NOT_ARCHIVED",
        )

    project.lifecycle_state = ProjectLifecycleState.active
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
        request=request,
    )
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
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[dict[str, object]]:
    """List members of a project. Visible to project members, org admins, and
    super-admins. Non-member non-admins get a 404 to keep existence-leakage
    closed."""
    project = await _load_project_or_404(session, project_id)
    await _require_member_viewer(session, project.id, user, active_org_id)

    total = (
        await session.scalar(
            select(func.count())
            .select_from(ProjectMember)
            .where(ProjectMember.project_id == project.id)
        )
    ) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = (
        select(ProjectMember, User.email, User.full_name)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project.id)
        .order_by(ProjectMember.created_at)
        .limit(limit)
        .offset(offset)
    )
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
    project = await _load_project_or_404(session, project_id)
    await _require_member_manager(session, project.id, user, active_org_id)
    _require_project_writable(project)

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
    project = await _load_project_or_404(session, project_id)
    await _require_member_manager(session, project.id, user, active_org_id)
    _require_project_writable(project)

    target = await _get_membership(session, project.id, user_id)
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
    project = await _load_project_or_404(session, project_id)
    await _require_member_manager(session, project.id, user, active_org_id)
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
    project = await _load_project_or_404(session, project_id)
    await _require_member_manager(session, project.id, user, active_org_id)
    _require_project_writable(project)

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
            request=request,
        )
        await ms.commit()

    # In-app notification (best-effort, after commit).
    from bimstitch_api.notifications.service import emit_notification_for_org
    from bimstitch_api.models.notification import NotificationEventType

    await emit_notification_for_org(
        organization_id=active_org_id,
        event_type=NotificationEventType.invitation_sent,
        title="Project invitation sent",
        body=f"{target_user.email} has been invited to {project.name}",
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
