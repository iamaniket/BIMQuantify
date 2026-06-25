"""Tenant-level job tracking endpoints.

Jobs are scoped to the current organisation via RLS — no explicit
`organization_id` filter is needed in the query.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from bimdossier_api.access import (
    is_org_admin,
    load_project_or_404,
    require_membership,
    require_project_read_access,
    require_project_writable,
)
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.auth.permissions import Action, Resource, require_permission
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.jobs import DispatchJobError
from bimdossier_api.jobs.lifecycle import cancel_job, retry_job
from bimdossier_api.models.job import Job, JobStatus, JobType
from bimdossier_api.models.project_member import ProjectMember
from bimdossier_api.models.user import User
from bimdossier_api.schemas.job import JobListResponse, JobRead
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/jobs", tags=["jobs"])

# Permission gate per retryable/cancellable job type, mirroring the resource's
# own mutation gate (file extraction → project_file.update, etc.).
_JOB_MUTATION_PERMISSION: dict[JobType, tuple[Resource, Action]] = {
    JobType.ifc_extraction: (Resource.project_file, Action.update),
    JobType.pdf_extraction: (Resource.project_file, Action.update),
    JobType.compliance_report: (Resource.report, Action.create),
    JobType.image_metadata_extraction: (Resource.attachment, Action.update),
}


async def _load_job_or_404(session: AsyncSession, job_id: UUID) -> Job:
    row = (await session.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="JOB_NOT_FOUND")
    return row


async def _authorize_job_mutation(session: AsyncSession, job: Job, user: User) -> None:
    """Require the caller to be a project member with rights to mutate this job."""
    perm = _JOB_MUTATION_PERMISSION.get(job.job_type)
    if perm is None or job.project_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="JOB_TYPE_NOT_RETRYABLE"
        )
    project = await load_project_or_404(session, job.project_id)
    require_project_writable(project)
    membership = await require_membership(session, job.project_id, user.id)
    require_permission(membership.role, perm[0], perm[1])


@router.get("", response_model=JobListResponse)
async def list_jobs(
    project_id: UUID | None = Query(default=None),
    job_status: JobStatus | None = Query(default=None, alias="status"),
    job_type: JobType | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> JobListResponse:
    stmt = select(Job)
    if project_id is not None:
        # Reading a specific project's jobs requires read access to THAT
        # project — not merely org membership. Non-members get 404.
        await require_project_read_access(session, project_id, user, active_org_id)
        stmt = stmt.where(Job.project_id == project_id)
    elif not (user.is_superuser or await is_org_admin(session, user.id, active_org_id)):
        # Without a project filter, a non-admin only sees jobs for projects
        # they belong to — never the whole org's jobs. Org-level jobs (no
        # project) are admin-only and excluded here by the membership join.
        member_projects = select(ProjectMember.project_id).where(
            ProjectMember.user_id == user.id
        )
        stmt = stmt.where(Job.project_id.in_(member_projects))
    if job_status is not None:
        stmt = stmt.where(Job.status == job_status)
    if job_type is not None:
        stmt = stmt.where(Job.job_type == job_type)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await session.scalar(count_stmt)) or 0

    stmt = stmt.options(defer(Job.payload), defer(Job.result))
    stmt = stmt.order_by(Job.created_at.desc()).limit(limit).offset(offset)
    items = list((await session.execute(stmt)).scalars().all())
    return JobListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/{job_id}", response_model=JobRead)
async def get_job(
    job_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Job:
    row = await _load_job_or_404(session, job_id)
    # JobRead exposes the full payload (storage keys, file ids) and result
    # (compliance findings), so org-scoping alone is not enough — gate on
    # read access to the job's project. Org-level jobs (no project) are
    # admin-only. Mirrors the mutation gate in `_authorize_job_mutation`.
    if row.project_id is None:
        if not (user.is_superuser or await is_org_admin(session, user.id, active_org_id)):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="JOB_NOT_FOUND")
    else:
        await require_project_read_access(session, row.project_id, user, active_org_id)
    return row


@router.post("/{job_id}/retry", response_model=JobRead)
async def retry_job_endpoint(
    job_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    settings: Settings = Depends(get_settings),
) -> Job:
    """Re-run a failed, retriable job. Creates a fresh Job with retry lineage."""
    job = await _load_job_or_404(session, job_id)
    await _authorize_job_mutation(session, job, user)
    new_job = await retry_job(
        session, job, settings=settings, organization_id=active_org_id, user=user
    )
    await session.refresh(new_job)
    return new_job


@router.post("/{job_id}/cancel", response_model=JobRead)
async def cancel_job_endpoint(
    job_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
    settings: Settings = Depends(get_settings),
) -> Job:
    """Cancel a still-queued job before the worker picks it up."""
    job = await _load_job_or_404(session, job_id)
    await _authorize_job_mutation(session, job, user)
    try:
        cancelled = await cancel_job(session, job, settings=settings)
    except DispatchJobError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="CANCEL_DISPATCH_FAILED"
        ) from exc
    await session.refresh(cancelled)
    return cancelled


__all__ = ["router"]
