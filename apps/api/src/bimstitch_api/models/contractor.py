from uuid import UUID, uuid4

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import TimestampMixin


class Contractor(TimestampMixin, TenantBase):
    """Contractor directory entry. Per-org via schema isolation — no
    `organization_id` column needed; the row lives in `org_<hex>.contractors`."""

    __tablename__ = "contractors"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kvk_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    __table_args__ = (
        UniqueConstraint("name", name="uq_contractors_name"),
    )
