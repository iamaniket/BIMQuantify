"""Endpoints for compliance checking on project files.

Connects to the Arbiter MCP server to evaluate IFC model data
against jurisdiction-specific regulation rules. NL today (BBL, WKB);
additional jurisdictions register via `bimdossier_api.jurisdictions`.
"""

import csv
import io
import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api import audit
from bimdossier_api.access import (
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.auth.ratelimit import COMPLIANCE_CHECK_LIMITER
from bimdossier_api.compliance import ComplianceCheckError, run_compliance_check
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.jurisdictions import is_supported_framework
from bimdossier_api.models.document import Document
from bimdossier_api.models.job import Job, JobStatus, JobType
from bimdossier_api.models.project_file import ExtractionStatus, ProjectFile
from bimdossier_api.models.user import User
from bimdossier_api.routers.documents import _load_document_or_404
from bimdossier_api.schemas.compliance import (
    ComplianceCheckRequest,
    ComplianceCheckResponse,
    ProjectComplianceReportItem,
    ProjectComplianceReportList,
)
from bimdossier_api.tenancy import (
    get_tenant_session,
    open_tenant_session,
    require_active_organization,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/documents/{document_id}/files/{file_id}/compliance",
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
    dependencies=[Depends(COMPLIANCE_CHECK_LIMITER)],
)
async def check_compliance(
    project_id: UUID,
    document_id: UUID,
    file_id: UUID,
    payload: ComplianceCheckRequest,
    request: Request,
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    settings: Settings = Depends(get_settings),
) -> ComplianceCheckResponse:
    """Trigger a compliance check for a file.

    The file must have extraction_status=succeeded with metadata and properties
    storage keys available.

    The Arbiter MCP call can take up to ``arbiter_timeout_seconds`` (~30s), so
    it MUST run with no tenant transaction open — otherwise it would pin a
    pooled DB connection for the whole call and exhaust ``DB_POOL_SIZE`` under
    concurrency, cascading into an API-wide blackout for the org. We therefore
    split the work into three phases, each its own short transaction:
      1. validate + create the ``running`` Job row (commit, release connection),
      2. call the Arbiter with NO connection held,
      3. persist the result/failure + audit.
    This mirrors the post-commit pattern in ``jobs_internal.py``. Do NOT fold
    this back into a single ``get_tenant_session`` request.
    """
    schema: str = request.state.active_schema

    # --- Phase 1: validate everything and persist a `running` Job, then commit
    # and return the connection to the pool.
    async with open_tenant_session(schema, active_org_id, user.id) as session:
        project = await load_project_or_404(session, project_id)
        membership = await require_membership(session, project.id, user.id)
        require_permission(membership.role, Resource.compliance, Action.create)
        require_project_writable(project)
        await _load_document_or_404(session, project.id, document_id)

        pf = (
            await session.execute(
                select(ProjectFile).where(
                    ProjectFile.id == file_id,
                    ProjectFile.document_id == document_id,
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

        # Building type drives which rules the Arbiter applies. Prefer an
        # explicit per-request override, else derive from the project's building
        # type, else "all" (no narrowing). The Arbiter's rule codes share the
        # project's neutral building-type vocabulary.
        effective_building_type = payload.building_type or (
            project.building_type.value if project.building_type else "all"
        )
        # Snapshot the values phases 2/3 need so we don't touch the (closed)
        # phase-1 session afterwards.
        metadata_key = pf.metadata_storage_key
        properties_key = pf.properties_storage_key
        file_uuid = pf.id
        project_uuid = project.id

        job = Job(
            id=uuid4(),
            project_id=project.id,
            file_id=pf.id,
            job_type=JobType.compliance_check,
            status=JobStatus.running,
            started_at=datetime.now(UTC),
            payload={
                "metadata_key": metadata_key,
                "properties_key": properties_key,
                "building_type": effective_building_type,
                "categories": payload.categories,
                "framework": payload.framework,
                "jurisdiction": project.country,
            },
            created_by_user_id=user.id,
        )
        session.add(job)
        await session.flush()
        job_id = job.id

    # --- Phase 2: external Arbiter call with NO DB connection held.
    try:
        result = await run_compliance_check(
            metadata_key=metadata_key,
            properties_key=properties_key,
            file_id=str(file_uuid),
            settings=settings,
            building_type=effective_building_type,
            categories=payload.categories,
            framework=payload.framework,
        )
    except ComplianceCheckError as exc:
        # --- Phase 3a: record the failure in a fresh short transaction.
        async with open_tenant_session(schema, active_org_id, user.id) as session:
            failed_job = await session.get(Job, job_id)
            if failed_job is not None:
                failed_job.status = JobStatus.failed
                failed_job.finished_at = datetime.now(UTC)
                failed_job.error = str(exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"COMPLIANCE_CHECK_FAILED: {exc}",
        ) from exc

    rules = result.get("rules_summary", [])
    pass_count = sum(1 for r in rules if r.get("status") == "pass")
    warn_count = sum(1 for r in rules if r.get("status") == "warn")
    fail_count = sum(1 for r in rules if r.get("status") == "fail")

    # --- Phase 3b: persist the result + audit in a fresh short transaction.
    async with open_tenant_session(schema, active_org_id, user.id) as session:
        succeeded_job = await session.get(Job, job_id)
        if succeeded_job is not None:
            succeeded_job.status = JobStatus.succeeded
            succeeded_job.finished_at = datetime.now(UTC)
            succeeded_job.result = result
        await audit.record(
            session,
            action="compliance.checked",
            resource_type="project_file",
            resource_id=file_uuid,
            after={
                "framework": payload.framework,
                "pass_count": pass_count,
                "warn_count": warn_count,
                "fail_count": fail_count,
            },
            actor_user_id=user.id,
            project_id=project_uuid,
            request=request,
        )

    return ComplianceCheckResponse(
        file_id=str(file_uuid),
        job_id=job_id,
        framework=payload.framework,
        checked_at=result.get("checked_at", ""),
        total_rules=result.get("total_rules", 0),
        total_elements_checked=result.get("total_elements_checked", 0),
        rules_summary=rules,
        category_summary=result.get("category_summary", []),
        details=result.get("details", []),
    )


async def _load_latest_compliance_job(
    session: AsyncSession,
    project_id: UUID,
    file_id: UUID,
    framework: str,
) -> Job:
    """Return the most recent succeeded compliance job for (project, file, framework).

    Filters on `payload->>'framework'` since the framework now lives in the
    job payload, not the job_type column.

    The `project_id` predicate binds the job to the project in the request
    path: without it, a member of project A could pass a `file_id` belonging
    to a sibling project B (same org schema) and read B's compliance results
    (cross-project IDOR). The read-access gate only checks the *path* project,
    so the job lookup must constrain by it too.

    Raises 404 NO_COMPLIANCE_RESULTS if none exists or the job has no result.
    """
    job = (
        await session.execute(
            select(Job)
            .where(
                Job.project_id == project_id,
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
    document_id: UUID,
    file_id: UUID,
    framework: str = Query(default="bbl", description="Regulation framework (bbl, wkb)"),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> ComplianceCheckResponse:
    """Get the most recent compliance check results for a file, including per-element details."""
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    job = await _load_latest_compliance_job(session, project.id, file_id, framework)
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
    document_id: UUID,
    file_id: UUID,
    framework: str = Query(default="bbl", description="Regulation framework (bbl, wkb)"),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Response:
    """Stream the latest compliance results for a file as CSV (one row per detail item)."""
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    job = await _load_latest_compliance_job(session, project.id, file_id, framework)
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
    document_id: UUID,
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
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    job = await _load_latest_compliance_job(session, project.id, file_id, framework)
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
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    stmt = (
        select(Job, ProjectFile, Document)
        .join(ProjectFile, ProjectFile.id == Job.file_id)
        .join(Document, Document.id == ProjectFile.document_id)
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
                document_id=mdl.id,
                document_name=mdl.name,
                document_discipline=mdl.discipline.value,
                file_name=pf.original_filename,
                file_version=pf.version_number,
                framework=job_framework,
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
