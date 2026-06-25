from __future__ import annotations

import enum
from uuid import UUID, uuid4

from sqlalchemy import Enum as SAEnum
from sqlalchemy import Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase
from bimdossier_api.models._mixins import TimestampMixin


class AccessRequestStatus(str, enum.Enum):
    new = "new"
    approved = "approved"
    rejected = "rejected"


class AccessRequest(TimestampMixin, MasterBase):
    """Lead-capture row for prospects requesting a BimDossier demo.

    Lives outside the tenant tree — no organization_id — because the row
    exists before any account is created. Admins review and approve later;
    approval is a separate flow that creates the user + organization.
    """

    __tablename__ = "access_requests"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    work_email: Mapped[str] = mapped_column(String(320), nullable=False)
    company: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(120), nullable=False)
    company_size: Mapped[str] = mapped_column(String(20), nullable=False)
    country: Mapped[str] = mapped_column(String(2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[AccessRequestStatus] = mapped_column(
        SAEnum(
            AccessRequestStatus,
            name="accessrequeststatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=AccessRequestStatus.new,
        server_default=AccessRequestStatus.new.value,
    )

    __table_args__ = (
        Index("ix_access_requests_work_email", "work_email"),
        Index("ix_access_requests_status", "status"),
        Index("ix_access_requests_created_at", "created_at"),
        {"schema": "public"},
    )
