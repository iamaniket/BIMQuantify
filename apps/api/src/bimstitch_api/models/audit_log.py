from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimstitch_api.db import MasterBase


class AuditLog(MasterBase):
    """Append-only log of identity/admin mutations.

    Scope: auth events (login/logout/refresh/switch), user lifecycle, org
    CRUD, organization_member changes, project_member changes. App data
    (project file uploads, model state changes, etc.) is NOT logged here.

    Always written from the app layer — not via Postgres triggers — because
    triggers can't see request_id, user_agent, or the HTTP actor.

    Sensitive fields in `before`/`after` are stripped by the redaction map
    in `bimstitch_api.audit.REDACT_FIELDS_BY_TABLE` before persistence.
    """

    __tablename__ = "audit_log"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Actor — null for anonymous events (e.g. failed login with unknown email).
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Org context — null for cross-org / platform events.
    organization_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Dotted action code, e.g. 'organization.created', 'organization_member.invited'.
    action: Mapped[str] = mapped_column(String(100), nullable=False)

    # The kind of thing the action operated on, e.g. 'organization', 'user',
    # 'project_member'. Used for filtering, not enforcement.
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # UUID of the row this action targeted, as a string. Not a FK because the
    # target may live in a tenant schema or may have been deleted.
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Pre- and post-mutation state, JSONB-serialized. Both nullable: insert
    # has no `before`, delete has no `after`, login events have neither.
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Request context, populated by audit.record() from the FastAPI Request
    # when available. Useful for forensic correlation across the audit log
    # and any external request tracing.
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_audit_org_time", "organization_id", "created_at"),
        Index("ix_audit_user_time", "user_id", "created_at"),
        Index("ix_audit_resource", "resource_type", "resource_id"),
        Index("ix_audit_action_time", "action", "created_at"),
    )
