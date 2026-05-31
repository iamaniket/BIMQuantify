from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimstitch_api.db import TenantBase


class NotificationEventType(StrEnum):
    # Job-pipeline events (existing — emitted by extraction, compliance,
    # PDF generation).
    job_started = "job_started"
    job_succeeded = "job_succeeded"
    job_failed = "job_failed"
    job_progress = "job_progress"

    # Wkb-deadline events (backlog #28 / #29). The producer side ships with
    # the deadline tracker; the enum values are extended ahead of producers
    # so the notification feed UI can ship its filtering chrome first.
    deadline_upcoming = "deadline_upcoming"
    deadline_missed = "deadline_missed"

    # Bevinding lifecycle events (backlog #25 / #26).
    finding_created = "finding_created"
    finding_resolved = "finding_resolved"

    # Project-scoped invitations (backlog #8 / #11).
    invitation_sent = "invitation_sent"
    invitation_accepted = "invitation_accepted"


class Notification(TenantBase):
    __tablename__ = "notifications"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="SET NULL"),
        nullable=True,
    )
    job_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    event_type: Mapped[NotificationEventType] = mapped_column(
        SAEnum(
            NotificationEventType,
            name="notificationeventtype",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_notifications_created_at", text("created_at DESC")),
        Index("ix_notifications_project_id", "project_id"),
        Index("ix_notifications_file_id", "file_id"),
        Index("ix_notifications_job_id", "job_id"),
    )


class NotificationRead(TenantBase):
    __tablename__ = "notification_reads"

    notification_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("notifications.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class NotificationDismissal(TenantBase):
    """Per-user dismissal of an org-shared notification.

    Notifications carry no ``user_id`` — the row is visible to every member of
    the org. Dismissal is therefore tracked per user (exactly like
    ``NotificationRead``): a dismissed notification is filtered out of *this*
    user's feed and counts, while teammates still see it. There is no hard
    delete of the shared row.
    """

    __tablename__ = "notification_dismissals"

    notification_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("notifications.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    dismissed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
