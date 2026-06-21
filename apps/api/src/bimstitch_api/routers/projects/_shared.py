from datetime import date
from uuid import UUID

from fastapi import (
    APIRouter,
    HTTPException,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.jurisdictions import find_instrument, supported_countries
from bimstitch_api.jurisdictions import get as get_jurisdiction
from bimstitch_api.models.contractor import Contractor
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.project import (
    ConsequenceClass,
    Project,
)
from bimstitch_api.models.project_member import ProjectMember, ProjectRole
from bimstitch_api.models.user import User
from bimstitch_api.schemas.project import (
    ProjectRead,
)
from bimstitch_api.storage import StorageBackend

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
