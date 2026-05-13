"""Generated reports (compliance PDF, future borgingsplan/verklaring/dossier).

A `Report` is a derived artifact: produced by the processor worker from
data already in the system (e.g. a compliance Job's `result` JSONB) and
stored in S3 as a PDF. Distinct from `ProjectFile` because:

* Reports are not user uploads — they're system output.
* Multiple reports per project per type are normal (regenerate is the
  expected mental model; no upsert).
* `report_type` is polymorphic — today only `compliance_report`; the same
  table will host borgingsplan / verklaring / dossier when those land.
* The lifecycle (queued → running → ready → failed) is independent of
  job-row retention.

The pointer to `source_job_id` lets the UI tell the user which compliance
run a report was generated from, and lets background re-runs find the
right input data.
"""

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimstitch_api.db import Base
from bimstitch_api.models._mixins import TimestampMixin


class ReportType(StrEnum):
    compliance_report = "compliance_report"
    # Reserved for later milestones (#31/#32/#33):
    # borgingsplan = "borgingsplan"
    # verklaring = "verklaring"
    # dossier = "dossier"


class ReportStatus(StrEnum):
    queued = "queued"
    running = "running"
    ready = "ready"
    failed = "failed"


_REPORT_TERMINAL: frozenset[ReportStatus] = frozenset(
    {ReportStatus.ready, ReportStatus.failed}
)


class Report(TimestampMixin, Base):
    __tablename__ = "reports"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    report_type: Mapped[ReportType] = mapped_column(
        SAEnum(
            ReportType,
            name="reporttype",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    status: Mapped[ReportStatus] = mapped_column(
        SAEnum(
            ReportStatus,
            name="reportstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=ReportStatus.queued,
        server_default=ReportStatus.queued.value,
    )

    # The Job that does the actual rendering work.
    job_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Pointer to the data source. For compliance_report this is the
    # compliance Job whose `result` JSONB was rendered (framework lives
    # in the source job's payload, not on the report row).
    source_job_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="SET NULL"),
        nullable=True,
    )

    # S3 artifact (set when status=ready).
    storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    byte_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # User-facing.
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False)

    # Snapshot of the request params (filters, options) — useful for audit.
    params: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_reports_organization_id", "organization_id"),
        Index(
            "ix_reports_project_created_at",
            "project_id",
            text("created_at DESC"),
        ),
        Index("ix_reports_status", "status"),
        Index(
            "ix_reports_job_id", "job_id", postgresql_where=text("job_id IS NOT NULL")
        ),
        Index("ix_reports_report_type", "report_type"),
    )
