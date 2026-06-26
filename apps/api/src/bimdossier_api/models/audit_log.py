from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import TenantBase


class AuditLog(TenantBase):
    """Append-only log of mutations, stored per-tenant.

    This is a tenant table: one `audit_log` lives in each org schema
    (`org_<hex>`), so a row's organization is implied by the schema it sits
    in — there is no `organization_id` column. Events with no single org
    (anonymous auth failures, platform-level super-admin actions) are written
    into the platform org's schema.

    Scope: auth events (login/logout/refresh/switch), user lifecycle, org
    CRUD, organization_member changes, project_member changes, plus
    project-scoped app events (file uploads, extraction, reports) that feed
    the project activity feed.

    Always written from the app layer — not via Postgres triggers — because
    triggers can't see request_id, user_agent, or the HTTP actor.

    Sensitive fields in `before`/`after` are stripped by the redaction map
    in `bimdossier_api.audit.REDACT_FIELDS_BY_TABLE` before persistence.
    """

    __tablename__ = "audit_log"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Actor — null for anonymous events (e.g. failed login with unknown email).
    # When the action was taken via a super-admin impersonation token,
    # `user_id` is the IMPERSONATED user (the one shown in audit lists for
    # that user's activity) and `impersonator_user_id` records the real
    # super admin who initiated the session.
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Super admin who initiated an impersonation session, if any. NULL for
    # all non-impersonated traffic. Populated automatically by
    # `audit.record(...)` from request.state when the access token carries
    # an `imp` claim.
    impersonator_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Project context — null for non-project events (auth, org-level).
    # FK-less by design: platform-schema rows reference projects that live in
    # other schemas, and a target project may have been deleted.
    project_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
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
        Index("ix_audit_user_time", "user_id", "created_at"),
        Index("ix_audit_resource", "resource_type", "resource_id"),
        Index("ix_audit_action_time", "action", "created_at"),
        Index("ix_audit_impersonator_time", "impersonator_user_id", "created_at"),
        Index("ix_audit_project_time", "project_id", "created_at"),
    )
