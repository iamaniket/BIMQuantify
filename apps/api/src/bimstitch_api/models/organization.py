from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimstitch_api.db import MasterBase


class OrganizationStatus(StrEnum):
    provisioning = "provisioning"   # saga in flight; schema not ready yet
    active = "active"
    suspended = "suspended"          # admin can read but not act
    deleted = "deleted"              # soft-deleted; schema may already be dropped


class Organization(MasterBase):
    """Tenant root. One Postgres schema (`schema_name`) per row holds all
    tenant data. Provisioning is a saga in `admin/provisioning.py` — never
    INSERT this row directly outside that saga.
    """

    __tablename__ = "organizations"
    __table_args__ = {"schema": "public"}

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)

    # Postgres schema that holds this org's tenant tables. Format: `org_<hex>`
    # where `<hex>` is the org id with dashes stripped (32 chars). Stored so
    # we can audit/list without recomputing from id and so cross-references
    # in scripts stay readable.
    schema_name: Mapped[str] = mapped_column(String(63), unique=True, nullable=False)

    status: Mapped[OrganizationStatus] = mapped_column(
        SAEnum(
            OrganizationStatus,
            name="organizationstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=OrganizationStatus.provisioning,
        server_default=OrganizationStatus.provisioning.value,
    )

    # Max consumed seats (pending + active + suspended members). NULL = unlimited.
    seat_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    provisioned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
