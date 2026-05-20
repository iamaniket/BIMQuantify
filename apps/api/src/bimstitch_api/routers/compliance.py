"""Endpoints for compliance checking on project files.

Connects to the Arbiter MCP server to evaluate IFC model data
against jurisdiction-specific regulation rules. NL today (BBL, WKB);
additional jurisdictions register via `bimstitch_api.jurisdictions`.
"""

import csv
import io
import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.compliance import ComplianceCheckError, run_compliance_check
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.jurisdictions import is_supported_framework
from bimstitch_api.models.job import Job, JobStatus, JobType
from bimstitch_api.models.model import Model
from bimstitch_api.models.project_file import ExtractionStatus, ProjectFile
from bimstitch_api.models.user import User
from bimstitch_api.routers.models import _load_model_or_404
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_project_read_access,
)
from bimstitch_api.schemas.compliance import (
    ComplianceCheckRequest,
    ComplianceCheckResponse,
    ProjectComplianceReportItem,
    ProjectComplianceReportList,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/models/{model_id}/files/{file_id}/compliance",
    tags=["compliance"],
)

project_router = APIRouter(
    prefix="/projects/{project_id}/compliance",
    tags=["compliance"],
)

# All compliance checks share a single JobType — the regulation framework
# (bbl, wkb, …) lives in the job payload. The processor worker dispatches on
# `payload.framework` against its registered rule packs.


@router.post(
    "/check",
    response_model=ComplianceCheckResponse,
)
async def check_compliance(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    payload: ComplianceCheckRequest,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    settings: Settings = Depends(get_settings),
) -> ComplianceCheckResponse:
    """Trigger a compliance check for a file.

    The file must have extraction_status=succeeded with metadata and properties
    storage keys available.
    """
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)
    await _load_model_or_404(session, project.id, model_id)

    pf = (
        await session.execute(
            select(ProjectFile).where(
                ProjectFile.id == file_id,
                ProjectFile.model_id == model_id,
            )
        )
    ).scalar_one_or_none()
    if pf is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="FILE_NOT_FOUND",
        )

    if pf.extraction_status != ExtractionStatus.succeeded:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="EXTRACTION_NOT_COMPLETE",
        )

    if not pf.metadata_storage_key or not pf.properties_storage_key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="MISSING_ARTIFACTS",
        )

    if not is_supported_framework(project.country, payload.framework):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"FRAMEWORK_NOT_REGISTERED: '{payload.framework}' is not "
                f"registered for country '{project.country}'"
            ),
        )

    job = Job(
        id=uuid4(),
        project_id=project.id,
        file_id=pf.id,
        job_type=JobType.compliance_check,
        status=JobStatus.pending,
        payload={
            "metadata_key": pf.metadata_storage_key,
            "properties_key": pf.properties_storage_key,
            "building_type": payload.building_type,
            "categories": payload.categories,
            "framework": payload.framework,
            "jurisdiction": project.country,
        },
        created_by_user_id=user.id,
    )
    session.add(job)

    try:
        job.status = JobStatus.running
        job.started_at = datetime.now(UTC)

        result = await run_compliance_check(
            metadata_key=pf.metadata_storage_key,
            properties_key=pf.properties_storage_key,
            file_id=str(pf.id),
            settings=settings,
            building_type=payload.building_type,
            categories=payload.categories,
            framework=payload.framework,
        )

        job.status = JobStatus.succeeded
        job.finished_at = datetime.now(UTC)
        job.result = result

    except ComplianceCheckError as exc:
        job.status = JobStatus.failed
        job.finished_at = datetime.now(UTC)
        job.error = str(exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"COMPLIANCE_CHECK_FAILED: {exc}",
        ) from exc

    return ComplianceCheckResponse(
        file_id=str(pf.id),
        job_id=job.id,
        framework=payload.framework,
        checked_at=result.get("checked_at", ""),
        total_rules=result.get("total_rules", 0),
        total_elements_checked=result.get("total_elements_checked", 0),
        rules_summary=result.get("rules_summary", []),
        category_summary=result.get("category_summary", []),
        details=result.get("details", []),
    )


async def _load_latest_compliance_job(
    session: AsyncSession,
    file_id: UUID,
    framework: str,
) -> Job:
    """Return the most recent succeeded compliance job for (file, framework).

    Filters on `payload->>'framework'` since the framework now lives in the
    job payload, not the job_type column.

    Raises 404 NO_COMPLIANCE_RESULTS if none exists or the job has no result.
    """
    job = (
        await session.execute(
            select(Job)
            .where(
                Job.file_id == file_id,
                Job.job_type == JobType.compliance_check,
                Job.status == JobStatus.succeeded,
                Job.payload["framework"].astext == framework,
            )
            .order_by(Job.finished_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if job is None or job.result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NO_COMPLIANCE_RESULTS",
        )
    return job


@router.get(
    "/latest",
    response_model=ComplianceCheckResponse,
)
async def get_latest_compliance(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    framework: str = Query(default="bbl", description="Regulation framework (bbl, wkb)"),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> ComplianceCheckResponse:
    """Get the most recent compliance check results for a file, including per-element details."""
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

    job = await _load_latest_compliance_job(session, file_id, framework)
    result = job.result or {}

    return ComplianceCheckResponse(
        file_id=str(file_id),
        job_id=job.id,
        framework=framework,
        checked_at=result.get("checked_at", ""),
        total_rules=result.get("total_rules", 0),
        total_elements_checked=result.get("total_elements_checked", 0),
        rules_summary=result.get("rules_summary", []),
        category_summary=result.get("category_summary", []),
        details=result.get("details", []),
    )


_CSV_COLUMNS: tuple[str, ...] = (
    "rule_id",
    "article",
    "status",
    "severity",
    "element_type",
    "element_name",
    "element_global_id",
    "property_path",
    "expected_value",
    "actual_value",
    "message",
)


@router.get(
    "/export.csv",
    response_class=Response,
)
async def export_compliance_csv(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    framework: str = Query(default="bbl", description="Regulation framework (bbl, wkb)"),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    """Stream the latest compliance results for a file as CSV (one row per detail item)."""
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

    job = await _load_latest_compliance_job(session, file_id, framework)
    details = (job.result or {}).get("details", []) or []

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(_CSV_COLUMNS), extrasaction="ignore")
    writer.writeheader()
    for item in details:
        if not isinstance(item, dict):
            continue
        writer.writerow({col: item.get(col, "") for col in _CSV_COLUMNS})

    filename = f"compliance-{framework}-{file_id}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


_RULES_CSV_COLUMNS: tuple[str, ...] = (
    "rule_id",
    "article",
    "title",
    "title_nl",
    "category",
    "severity",
    "total_checked",
    "passed",
    "warned",
    "failed",
    "skipped",
    "errors",
)


@router.get(
    "/export-rules.csv",
    response_class=Response,
)
async def export_compliance_rules_csv(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    framework: str = Query(default="bbl", description="Regulation framework (bbl, wkb)"),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    """Stream the per-rule summary from the latest compliance results as CSV.

    One row per rule with pass/warn/fail/skip/error counts — useful for
    portfolio-level reporting where individual element failures are too noisy.
    """
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

    job = await _load_latest_compliance_job(session, file_id, framework)
    rules = (job.result or {}).get("rules_summary", []) or []

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(_RULES_CSV_COLUMNS), extrasaction="ignore")
    writer.writeheader()
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        writer.writerow({col: rule.get(col, "") for col in _RULES_CSV_COLUMNS})

    filename = f"compliance-rules-{framework}-{file_id}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@project_router.get(
    "/reports",
    response_model=ProjectComplianceReportList,
)
async def list_project_reports(
    project_id: UUID,
    framework: str | None = Query(
        default=None, description="Filter by framework (bbl, wkb). Omit for all."
    ),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> ProjectComplianceReportList:
    """List the latest succeeded compliance report per (file, framework) for a project."""
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

    stmt = (
        select(Job, ProjectFile, Model)
        .join(ProjectFile, ProjectFile.id == Job.file_id)
        .join(Model, Model.id == ProjectFile.model_id)
        .where(
            Job.project_id == project.id,
            Job.job_type == JobType.compliance_check,
            Job.status == JobStatus.succeeded,
        )
    )
    if framework is not None:
        stmt = stmt.where(Job.payload["framework"].astext == framework)

    stmt = stmt.order_by(
        Job.file_id,
        Job.payload["framework"].astext,
        Job.finished_at.desc(),
    )

    rows = (await session.execute(stmt)).all()

    # Keep latest job per (file_id, framework). Rows are sorted by finished_at desc,
    # so the first occurrence of each (file_id, framework) pair is the latest.
    seen: set[tuple[UUID, str]] = set()
    items: list[ProjectComplianceReportItem] = []
    for job, pf, mdl in rows:
        job_framework = str((job.payload or {}).get("framework") or "")
        if not job_framework:
            continue
        key = (pf.id, job_framework)
        if key in seen:
            continue
        seen.add(key)

        result = job.result or {}
        category_summary = result.get("category_summary", []) or []
        pass_count = sum(int(c.get("passed", 0)) for c in category_summary)
        warn_count = sum(int(c.get("warned", 0)) for c in category_summary)
        fail_count = sum(int(c.get("failed", 0)) for c in category_summary)
        total = pass_count + warn_count + fail_count
        score = round(pass_count / total * 100) if total > 0 else 0

        items.append(
            ProjectComplianceReportItem(
                job_id=job.id,
                file_id=pf.id,
                model_id=mdl.id,
                model_name=mdl.name,
                model_discipline=mdl.discipline.value,
                file_name=pf.original_filename,
                file_version=pf.version_number,
                framework=job_framework,  # type: ignore[arg-type]
                checked_at=result.get("checked_at", ""),
                finished_at=job.finished_at,
                pass_count=pass_count,
                warn_count=warn_count,
                fail_count=fail_count,
                total_rules=int(result.get("total_rules", 0)),
                total_elements_checked=int(result.get("total_elements_checked", 0)),
                overall_score=score,
            )
        )

    items.sort(key=lambda x: x.finished_at, reverse=True)
    return ProjectComplianceReportList(items=items)
