from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Text, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import TimestampMixin


class JobType(StrEnum):
    ifc_extraction = "ifc_extraction"
    pdf_extraction = "pdf_extraction"
    dxf_extraction = "dxf_extraction"
    verification = "verification"
    batch_update = "batch_update"
    image_metadata_extraction = "image_metadata_extraction"
    compliance_check = "compliance_check"
    compliance_report = "compliance_report"
    # Report renderers — one JobType per pipeline, mirroring compliance_report.
    assurance_plan_report = "assurance_plan_report"  # NL: borgingsplan PDF (#31)
    completion_declaration_report = "completion_declaration_report"  # NL: verklaring (#32)
    dossier_report = "dossier_report"  # dossier bevoegd gezag (#33)
    snag_list_report = "snag_list_report"  # per-recipient bevindingen snag-list PDF (#G2)


class JobStatus(StrEnum):
    pending = "pending"
    started = "started"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


_JOB_TERMINAL: frozenset[JobStatus] = frozenset(
    {JobStatus.succeeded, JobStatus.failed, JobStatus.cancelled}
)


class Job(TimestampMixin, TenantBase):
    """Background job — lives in `org_<hex>.jobs`. No `organization_id`
    column; the schema name IS the organization. The processor worker
    receives `organization_id` separately in the dispatch envelope and
    echoes it back in the callback so the API can resolve the schema.
    """

    __tablename__ = "jobs"

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
    job_type: Mapped[JobType] = mapped_column(
        SAEnum(
            JobType,
            name="jobtype",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    status: Mapped[JobStatus] = mapped_column(
        SAEnum(
            JobStatus,
            name="jobstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=JobStatus.pending,
        server_default=JobStatus.pending.value,
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # `retriable` is set on terminal failure: True when retrying could plausibly
    # succeed (network/S3/OOM/timeout/dispatch), False for permanent errors
    # (bad input, parse failure, hash mismatch). Drives the UI Retry affordance.
    retriable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    # Free-form classifier tag from the worker (e.g. "dispatch", "parse",
    # "network"). Informational; `retriable` is the gate.
    error_kind: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 0-100 progress reported by the worker on `running` callbacks.
    progress: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    # Lineage: the failed job this one was spawned to retry, if any.
    retry_of: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    # 1 for the original dispatch; incremented on each retry.
    attempt: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        Index("ix_jobs_project_id", "project_id", postgresql_where=text("project_id IS NOT NULL")),
        Index("ix_jobs_file_id", "file_id", postgresql_where=text("file_id IS NOT NULL")),
        Index("ix_jobs_status", "status"),
        Index("ix_jobs_job_type", "job_type"),
        Index("ix_jobs_created_at", text("created_at DESC")),
        Index("ix_jobs_created_by", "created_by_user_id"),
        Index("ix_jobs_retry_of", "retry_of", postgresql_where=text("retry_of IS NOT NULL")),
        Index(
            "ix_jobs_project_created",
            "project_id",
            text("created_at DESC"),
            postgresql_where=text("project_id IS NOT NULL"),
        ),
    )
