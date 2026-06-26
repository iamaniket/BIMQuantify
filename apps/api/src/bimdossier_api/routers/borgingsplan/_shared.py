"""Cross-cutting walk helpers shared by moment + checklist-item routers."""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.access import load_project_or_404
from bimdossier_api.models.borgingsmoment import Borgingsmoment
from bimdossier_api.models.borgingsplan import Borgingsplan
from bimdossier_api.models.project import Project


async def _walk_to_project_via_moment(
    session: AsyncSession, moment: Borgingsmoment
) -> tuple[Project, Borgingsplan]:
    plan = (
        await session.execute(
            select(Borgingsplan).where(Borgingsplan.id == moment.borgingsplan_id)
        )
    ).scalar_one_or_none()
    if plan is None:
        # Shouldn't happen — orphan moments are blocked by FK CASCADE.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="BORGINGSPLAN_NOT_FOUND"
        )
    project = await load_project_or_404(session, plan.project_id)
    return project, plan


async def _walk_to_project_via_plan(
    session: AsyncSession, plan: Borgingsplan
) -> Project:
    return await load_project_or_404(session, plan.project_id)
