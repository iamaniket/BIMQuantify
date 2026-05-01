"""Tenant-level job tracking endpoints.

Jobs are scoped to the current organisation via RLS — no explicit
`organization_id` filter is needed in the query.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.models.job import Job, JobStatus, JobType
from bimstitch_api.models.user import User
from bimstitch_api.schemas.job import JobListResponse, JobRead
from bimstitch_api.tenancy import get_tenant_session

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("", response_model=JobListResponse)
async def list_jobs(
    project_id: UUID | None = Query(default=None),
    job_status: JobStatus | None = Query(default=None, alias="status"),
    job_type: JobType | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> JobListResponse:
    stmt = select(Job)
    if project_id is not None:
        stmt = stmt.where(Job.project_id == project_id)
    if job_status is not None:
        stmt = stmt.where(Job.status == job_status)
    if job_type is not None:
        stmt = stmt.where(Job.job_type == job_type)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await session.scalar(count_stmt)) or 0

    stmt = stmt.order_by(Job.created_at.desc()).limit(limit).offset(offset)
    items = list((await session.execute(stmt)).scalars().all())
    return JobListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/{job_id}", response_model=JobRead)
async def get_job(
    job_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Job:
    row = (
        await session.execute(select(Job).where(Job.id == job_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="JOB_NOT_FOUND")
    return row


__all__ = ["router"]
