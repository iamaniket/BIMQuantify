"""Per-org and per-project deadline notification preferences.

When ``project_id IS NULL`` the row is an **org-level default** that applies
to every project in the organization unless overridden. When ``project_id``
is set, the row is a **project-level override** that wins for that project.

Rows are only created when someone customises settings — the system falls
back to ``DeadlineRule.default_reminder_days`` /
``DeadlineRule.default_recipient_roles`` from the jurisdiction registry
when no DB row exists. This means a freshly-provisioned org works out of
the box with zero seed data.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import TimestampMixin


class DeadlineNotificationSettings(TimestampMixin, TenantBase):
    __tablename__ = "deadline_notification_settings"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
    )
    deadline_type: Mapped[str] = mapped_column(String(50), nullable=False)
    reminder_days: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False)
    recipient_roles: Mapped[list[str]] = mapped_column(ARRAY(String(20)), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (
        # One override per (project, deadline_type).
        UniqueConstraint(
            "project_id",
            "deadline_type",
            name="uq_dl_notif_settings_project_type",
        ),
        # Exactly one org-default per deadline_type (project_id IS NULL).
        Index(
            "uq_dl_notif_org_default",
            "deadline_type",
            unique=True,
            postgresql_where="project_id IS NULL",
        ),
        Index("ix_dl_notif_settings_project_id", "project_id"),
    )
