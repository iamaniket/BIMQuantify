from uuid import UUID

from fastapi_users import schemas


class UserRead(schemas.BaseUser[UUID]):
    full_name: str | None = None
    organization_id: UUID | None = None


class UserCreate(schemas.BaseUserCreate):
    full_name: str | None = None
    organization_name: str | None = None

    def create_update_dict(self) -> dict[str, object]:
        data = super().create_update_dict()
        data.pop("organization_name", None)
        return data

    def create_update_dict_superuser(self) -> dict[str, object]:
        data = super().create_update_dict_superuser()
        data.pop("organization_name", None)
        return data


class UserUpdate(schemas.BaseUserUpdate):
    full_name: str | None = None
