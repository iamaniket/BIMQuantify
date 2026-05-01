from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimstitch_api.db import Base
from bimstitch_api.models._mixins import TimestampMixin


class Contractor(TimestampMixin, Base):
    __tablename__ = "contractors"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kvk_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_contractors_org_name"),
        Index("ix_contractors_organization_id", "organization_id"),
    )
