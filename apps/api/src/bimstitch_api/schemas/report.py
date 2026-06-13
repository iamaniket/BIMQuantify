"""Pydantic schemas for the Reports API and the worker → API callback."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from bimstitch_api.models.report import ReportStatus, ReportType

# ---------------------------------------------------------------------------
# User-facing
# ---------------------------------------------------------------------------


class ReportCreateRequest(BaseModel):
    """Body of POST /projects/{project_id}/reports."""

    # Defaults to compliance_report. Each type routes to a per-type source
    # resolver in the router; a known type whose resolver hasn't landed yet
    # returns a clean 422 REPORT_TYPE_NOT_AVAILABLE rather than queueing a job
    # no worker handles. An unknown value is rejected by enum coercion (422).
    report_type: ReportType = Field(default=ReportType.compliance_report)
    # If omitted, server resolves from the project's jurisdiction registry
    # entry (NL → 'nl'). Pass an explicit BCP47 code (e.g. 'en') to override.
    locale: str | None = Field(default=None, max_length=8)
    # Optional org report-template to render with. Must be a report-kind template
    # whose template_type matches report_type (else 422 TEMPLATE_TYPE_MISMATCH).
    # Omit to use the org default for this report type, or the built-in layout if
    # none is set.
    template_id: UUID | None = Field(default=None)
    # Optional input filters — for compliance_report you can scope to specific
    # files; omit for project-wide. Snapshotted into Report.params.
    params: dict = Field(default_factory=dict)


class ReportResponse(BaseModel):
    """Returned by POST /projects/{p}/reports, GET list, GET one."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    report_type: ReportType
    status: ReportStatus
    title: str
    locale: str
    job_id: UUID | None
    source_job_id: UUID | None
    template_id: UUID | None = None
    storage_key: str | None
    byte_size: int | None
    sha256: str | None
    error: str | None
    download_url: str | None = None  # Populated only when status=ready, presigned 15min.
    created_at: datetime
    finished_at: datetime | None
    # Verklaring sign-to-lock (#32). signed_at != null ⇒ locked.
    signed_at: datetime | None = None
    signed_by_user_id: UUID | None = None
    signature_hash: str | None = None


class ReportListResponse(BaseModel):
    items: list[ReportResponse]
    total: int


# ---------------------------------------------------------------------------
# Internal callback (worker → API)
# ---------------------------------------------------------------------------


class ReportCallbackRequest(BaseModel):
    """Body of POST /internal/jobs/reports/callback.

    Sent by the processor worker when a `compliance_report` job finishes.
    The worker has already uploaded the PDF to S3; this hands the resulting
    storage key + integrity metadata back to the API so the Report row can
    transition to `ready` (or `failed`).
    """

    report_id: UUID
    # `organization_id` is the schema-per-tenant routing key — the worker
    # echoes it from the dispatch envelope so the API knows which tenant
    # schema the Report row lives in.
    organization_id: UUID
    job_id: UUID
    status: Literal["running", "ready", "failed"]
    storage_key: str | None = None
    byte_size: int | None = None
    sha256: str | None = None
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    # 0-100 progress, sent on `running` callbacks at pipeline stage boundaries.
    progress: int | None = Field(default=None, ge=0, le=100)
    # On `failed`: whether retrying could plausibly succeed, plus a classifier tag.
    retriable: bool = False
    error_kind: str | None = None
