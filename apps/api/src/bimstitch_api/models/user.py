from uuid import UUID

from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimstitch_api.db import MasterBase


class User(SQLAlchemyBaseUserTableUUID, MasterBase):
    """Global user identity.

    No `organization_id` — a user can belong to many organizations via
    `organization_members`. The active context (which org the user is acting
    in right now) is `active_organization_id` and is also carried in the JWT
    claim that scopes RLS + `search_path` per request.
    """

    __tablename__ = "users"
    __table_args__ = {"schema": "public"}

    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # The org this user is currently working in. NULL is valid for a platform
    # superadmin who hasn't picked an org, or for a newly-created user before
    # they've accepted any invite. The login flow auto-sets this to the first
    # active membership if currently NULL.
    active_organization_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
