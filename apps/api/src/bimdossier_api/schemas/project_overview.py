"""Aggregate response for the project-detail dashboard.

One `GET /projects/{id}/overview` call replaces the ~10 the dashboard used to
fire on a cold load. Every block is built from the existing per-resource Read
schemas (no new row types) so the portal reuses its types; previews are capped
(`OVERVIEW_PREVIEW_LIMIT`) and counts come from cheap aggregates, keeping the
payload bounded regardless of project size.
"""

from pydantic import BaseModel

from bimdossier_api.deadlines.completeness import CompletenessBlock
from bimdossier_api.schemas.activity import ActivityTimelineBucket
from bimdossier_api.schemas.attachment import AttachmentRead
from bimdossier_api.schemas.certificate import CertificateRead
from bimdossier_api.schemas.deadline import DeadlineRead
from bimdossier_api.schemas.finding import FindingRead
from bimdossier_api.schemas.project import ProjectMemberRead, ProjectRead
from bimdossier_api.schemas.report import ReportResponse


class FindingsBlock(BaseModel):
    count: int
    # open + in_progress (the "still needs work" count).
    open: int
    preview: list[FindingRead]


class CertificatesBlock(BaseModel):
    count: int
    # valid_until < today.
    expired: int
    # 0..30 days until valid_until (matches the portal's EXPIRY_WARNING_DAYS).
    expiring_soon: int
    preview: list[CertificateRead]


class AttachmentsBlock(BaseModel):
    count: int
    preview: list[AttachmentRead]


class ReportsBlock(BaseModel):
    count: int
    preview: list[ReportResponse]


class DeadlinesBlock(BaseModel):
    # All deadlines including not_applicable — matches the header KPI's "n/N met"
    # (the donut's deadline wedge, which excludes not_applicable, lives on
    # `completeness.deadlines`). `preview` is the full small list (seeds the
    # deadlines tab / section without a second fetch).
    total: int
    met: int
    overdue: int
    preview: list[DeadlineRead]


class OverviewStats(BaseModel):
    """Header KPIs. `holdback_pct` is the dossier-only required percentage (what
    the header's HOLDBACK chip shows), not the overall donut percentage."""

    deadlines_met: int
    deadlines_total: int
    attachments_count: int
    holdback_pct: int
    delivery_days_remaining: int | None


class ProjectOverviewRead(BaseModel):
    project: ProjectRead
    completeness: CompletenessBlock
    stats: OverviewStats
    findings: FindingsBlock
    certificates: CertificatesBlock
    attachments: AttachmentsBlock
    reports: ReportsBlock
    deadlines: DeadlinesBlock
    members: list[ProjectMemberRead]
    activity_timeline: list[ActivityTimelineBucket]
