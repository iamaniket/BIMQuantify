from uuid import UUID

from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimstitch_api.db import Base


class User(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = "users"

    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    organization_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
