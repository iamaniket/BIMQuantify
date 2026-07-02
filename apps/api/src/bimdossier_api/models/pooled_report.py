"""Free-tier report rows — `public.pooled_reports`.

The pooled mirror of the tenant `Report` (reports are tenant-only; free users
have no schema), carrying only what the free snag-list PDF needs. `owner_user_id`
stays = the PROJECT owner (the pooled RLS/quota convention — a member may create
a report in a shared project); `created_by_user_id` records the requester, who
is the notification recipient when the PDF is ready.

`report_type` / `status` are String + CHECK (the "likely-to-grow → String+CHECK"
convention — the paid `reporttype` Postgres enum exists only in tenant schemas).
`job_id` is a plain column with no FK: pooled jobs are detached dispatch
envelopes, never persisted rows (`routers/pooled/_shared.py`).
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase
from bimdossier_api.models._pooled import PooledOwnedMixin, TimestampMixin, check_in

POOLED_REPORT_TYPES: tuple[str, ...] = ("snag_list",)
POOLED_REPORT_STATUSES: tuple[str, ...] = ("queued", "running", "ready", "failed")


class PooledReport(PooledOwnedMixin, TimestampMixin, MasterBase):
    __tablename__ = "pooled_reports"

    pooled_project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.pooled_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The requester (owner or editor member) — notification recipient.
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    report_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="snag_list", server_default="snag_list"
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="queued", server_default="queued"
    )
    # Detached dispatch-envelope id (no jobs table in the pooled plane).
    job_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    byte_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            check_in("report_type", POOLED_REPORT_TYPES),
            name="ck_pooled_reports_report_type",
        ),
        CheckConstraint(
            check_in("status", POOLED_REPORT_STATUSES),
            name="ck_pooled_reports_status",
        ),
        Index(
            "ix_pooled_reports_project_created",
            "pooled_project_id",
            text("created_at DESC"),
        ),
        Index("ix_pooled_reports_owner", "owner_user_id"),
        Index("ix_pooled_reports_status", "status"),
        {"schema": "public"},
    )
