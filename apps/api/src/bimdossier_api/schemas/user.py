from uuid import UUID

from fastapi_users import schemas


class UserRead(schemas.BaseUser[UUID]):
    full_name: str | None = None
    avatar_url: str | None = None
    active_organization_id: UUID | None = None


class UserCreate(schemas.BaseUserCreate):
    """Used by admin invite endpoints only — public signup is removed.
    The admin/invite flow constructs users directly via the UserManager,
    so this schema is the body for `POST /organizations/{id}/members`."""

    full_name: str | None = None


class UserUpdate(schemas.BaseUserUpdate):
    full_name: str | None = None
    avatar_url: str | None = None
