"""Pooled free-tier notifications — `public.pooled_notifications` (+ user-state).

Mirrors the paid `Notification` / `NotificationUserState` (models/notification.py)
on the pooled side so the free bell reuses the SAME UI + Zod schema. Two deliberate
differences from paid:

  * Pooled in `public` (MasterBase), recipient-keyed RLS — a free account is
    org-less, so there is no tenant schema to isolate by.
  * PER-RECIPIENT rows, not one org-shared row + per-user state. A free notification
    is targeted (the model's owner + each invited member gets their own row), so the
    RLS policy is a trivial `recipient_user_id = app.current_user_id` with no
    membership join. The state table is kept for a 1:1 read-API mirror with paid.

`event_type` is a `String` + CHECK, NOT a Postgres enum: the `notificationeventtype`
enum type is created only in the TENANT chain (the paid `Notification` is
`TenantBase`), so it does not exist in the production `public` schema these pooled
tables live in. Per the repo's enum-evolution rule a grow-y event-type set prefers
String+CHECK anyway. Values stay value-identical to `NotificationEventType` so the
portal's shared `NotificationEventTypeEnum` validates free rows unchanged.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase
from bimdossier_api.models._pooled import check_in

# Value-identical to the paid NotificationEventType members the free path emits.
# Only terminal extraction events apply to free today (no deadlines/mentions yet).
POOLED_NOTIFICATION_EVENT_TYPES: tuple[str, ...] = ("job_succeeded", "job_failed")


class PooledNotification(MasterBase):
    __tablename__ = "pooled_notifications"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    # The RLS key — one row per recipient (owner + each invited member). NOT NULL,
    # unlike paid (whose NULL recipient = org-wide).
    recipient_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    pooled_project_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.pooled_projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    pooled_document_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.pooled_documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    pooled_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.pooled_project_files.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Free jobs route via FREE_TIER_SENTINEL_ORG and live in no `public.jobs` table,
    # so this is a plain column (no FK) — and stays None on free rows so the portal's
    # JobControls short-circuits cleanly.
    job_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            check_in("event_type", POOLED_NOTIFICATION_EVENT_TYPES),
            name="ck_pooled_notifications_event_type",
        ),
        # Drives the list/count query (filter on recipient, order by created_at).
        Index(
            "ix_pooled_notifications_recipient_created",
            "recipient_user_id",
            "created_at",
        ),
        Index("ix_pooled_notifications_pooled_file_id", "pooled_file_id"),
        {"schema": "public"},
    )


class PooledNotificationUserState(MasterBase):
    """Per-user read/dismiss state over a free notification (mirrors paid).

    Free rows are already per-recipient, so `user_id` here always equals the
    notification's `recipient_user_id` — the table is kept solely to make the free
    read API a 1:1 copy of the paid one (read_at / dismissed_at independently
    nullable, same upsert semantics).
    """

    __tablename__ = "pooled_notification_user_state"

    notification_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.pooled_notifications.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = ({"schema": "public"},)
