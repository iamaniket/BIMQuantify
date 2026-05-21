from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimstitch_api.db import MasterBase


class OrganizationMemberStatus(StrEnum):
    pending = "pending"        # invited, not yet accepted/logged in
    active = "active"
    suspended = "suspended"    # admin paused this membership
    removed = "removed"        # tombstone; excluded from active-list reads


class OrganizationMember(MasterBase):
    """M:N join — one row per (user, org) pair.

    Status transitions:
      pending  -> active   (on first verified login, see auth/routes.py::login)
      active   -> suspended (org admin action)
      active   -> removed  (org admin action; cascades project_members in that org's schema)
      pending  -> removed  (invite revoked before acceptance)

    `is_org_admin=true` grants management rights over the org's members,
    projects, and tenants. It is org-local — being an admin in Acme says
    nothing about Beta.
    """

    __tablename__ = "organization_members"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    is_org_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    # Cross-org collaborator flag. A guest has a real membership row (and
    # uses the same tenancy/JWT-switch path as a regular member) but is
    # restricted: cannot be org_admin, does NOT count toward seat_limit,
    # cannot list org members or create projects, and only sees projects
    # they have an explicit `project_members` row in.
    is_guest: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    status: Mapped[OrganizationMemberStatus] = mapped_column(
        SAEnum(
            OrganizationMemberStatus,
            name="organizationmemberstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=OrganizationMemberStatus.active,
        server_default=OrganizationMemberStatus.active.value,
    )

    invited_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    invited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "organization_id", name="uq_org_member"),
        Index("ix_org_members_user", "user_id"),
        Index("ix_org_members_org", "organization_id"),
        Index(
            "ix_org_admins",
            "organization_id",
            "is_org_admin",
            postgresql_where=text("is_org_admin = true AND status = 'active'"),
        ),
        Index(
            "ix_org_members_user_active",
            "user_id",
            "status",
            postgresql_where=text("status = 'active'"),
        ),
        Index(
            "ix_org_members_guests",
            "organization_id",
            "is_guest",
            postgresql_where=text("is_guest = true AND status = 'active'"),
        ),
        Index(
            "ix_org_members_org_status",
            "organization_id",
            "status",
            postgresql_where=text("status = 'active'"),
        ),
        {"schema": "public"},
    )
