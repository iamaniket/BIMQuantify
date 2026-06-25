"""Idempotency log for deadline reminder / missed notifications.

Each row records that a specific notification has been sent for a
deadline. The unique constraints prevent double-sends:

- ``(deadline_id, notification_type, days_before)`` for reminders — one
  row per reminder tier (e.g. 14-day, 7-day) per deadline.
- ``(deadline_id)`` WHERE ``notification_type = 'missed'`` — one missed
  alert per deadline, ever.

When ``recompute_deadlines()`` resets a deadline back to ``pending``
(because the project date changed), the corresponding log rows are
deleted so the new due date gets fresh reminders.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import TenantBase


class DeadlineNotificationLog(TenantBase):
    __tablename__ = "deadline_notification_log"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    deadline_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("deadlines.id", ondelete="CASCADE"),
        nullable=False,
    )
    notification_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # "reminder" | "missed"
    days_before: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )  # which tier (e.g. 7); NULL for missed
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # One reminder notification per tier per deadline.
        UniqueConstraint(
            "deadline_id",
            "notification_type",
            "days_before",
            name="uq_dl_notif_log_reminder_dedup",
        ),
        # One missed notification per deadline (partial index).
        Index(
            "uq_dl_notif_log_missed",
            "deadline_id",
            unique=True,
            postgresql_where="notification_type = 'missed'",
        ),
        Index("ix_dl_notif_log_deadline_id", "deadline_id"),
        Index("ix_dl_notif_log_sent_at", "sent_at"),
    )
