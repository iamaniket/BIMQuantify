from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimstitch_api.db import Base
from bimstitch_api.models._mixins import TimestampMixin


class JobType(StrEnum):
    ifc_extraction = "ifc_extraction"
    pdf_extraction = "pdf_extraction"
    verification = "verification"
    batch_update = "batch_update"
    bbl_compliance_check = "bbl_compliance_check"
    wkb_compliance_check = "wkb_compliance_check"
    compliance_check = "compliance_check"


class JobStatus(StrEnum):
    pending = "pending"
    started = "started"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


_JOB_TERMINAL: frozenset[JobStatus] = frozenset({JobStatus.succeeded, JobStatus.failed})


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
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
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        Index("ix_jobs_organization_id", "organization_id"),
        Index("ix_jobs_status", "status"),
        Index("ix_jobs_job_type", "job_type"),
    )
