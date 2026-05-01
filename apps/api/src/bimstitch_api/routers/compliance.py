"""Endpoints for compliance checking on project files.

Connects to the compliance checker MCP server to evaluate IFC model data
against Dutch building regulation rules (BBL, WKB).
"""

import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.compliance import ComplianceCheckError, run_compliance_check
from bimstitch_api.config import Settings, get_settings
from bimstitch_api.models.job import Job, JobStatus, JobType
from bimstitch_api.models.project_file import ExtractionStatus, ProjectFile
from bimstitch_api.models.user import User
from bimstitch_api.routers.models import _load_model_or_404
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
)
from bimstitch_api.schemas.compliance import (
    ComplianceCheckRequest,
    ComplianceCheckResponse,
    ComplianceSummaryResponse,
)
from bimstitch_api.tenancy import get_tenant_session

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/models/{model_id}/files/{file_id}/compliance",
    tags=["compliance"],
)

_FRAMEWORK_JOB_TYPE: dict[str, JobType] = {
    "bbl": JobType.bbl_compliance_check,
    "wkb": JobType.wkb_compliance_check,
}


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

    job_type = _FRAMEWORK_JOB_TYPE.get(payload.framework, JobType.compliance_check)

    job = Job(
        id=uuid4(),
        organization_id=project.organization_id,
        project_id=project.id,
        file_id=pf.id,
        job_type=job_type,
        status=JobStatus.pending,
        payload={
            "metadata_key": pf.metadata_storage_key,
            "properties_key": pf.properties_storage_key,
            "building_type": payload.building_type,
            "categories": payload.categories,
            "framework": payload.framework,
        },
        created_by_user_id=user.id,
    )
    session.add(job)

    try:
        job.status = JobStatus.running
        job.started_at = datetime.now(timezone.utc)

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
        job.finished_at = datetime.now(timezone.utc)
        job.result = result

    except ComplianceCheckError as exc:
        job.status = JobStatus.failed
        job.finished_at = datetime.now(timezone.utc)
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


@router.get(
    "/latest",
    response_model=ComplianceSummaryResponse,
)
async def get_latest_compliance(
    project_id: UUID,
    model_id: UUID,
    file_id: UUID,
    framework: str = Query(default="bbl", description="Regulation framework (bbl, wkb)"),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> ComplianceSummaryResponse:
    """Get the most recent compliance check results for a file."""
    project = await _load_project_or_404(session, project_id)
    await _require_membership(session, project.id, user.id)

    job_type = _FRAMEWORK_JOB_TYPE.get(framework, JobType.compliance_check)

    job = (
        await session.execute(
            select(Job)
            .where(
                Job.file_id == file_id,
                Job.job_type == job_type,
                Job.status == JobStatus.succeeded,
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

    return ComplianceSummaryResponse(
        file_id=str(file_id),
        job_id=job.id,
        framework=framework,
        checked_at=job.result.get("checked_at", ""),
        total_rules=job.result.get("total_rules", 0),
        total_elements_checked=job.result.get("total_elements_checked", 0),
        rules_summary=job.result.get("rules_summary", []),
        category_summary=job.result.get("category_summary", []),
    )
