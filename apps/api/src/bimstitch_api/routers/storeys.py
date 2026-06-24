"""Read-only listing of a 3D model's storeys (levels).

Storeys are populated from the model's IFC extraction (see the processor +
``jobs_internal`` ingest); there is no write API — they are derived data. The
list is the anchor source for the aligned-sheet calibration UI (pick a floor)
and, later, for level-keyed findings.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.access import load_project_or_404, require_project_read_access
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.models.model import Model
from bimstitch_api.models.storeys import Storey
from bimstitch_api.models.user import User
from bimstitch_api.pagination import set_total_count
from bimstitch_api.schemas.storey import StoreyRead
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/models/{model_id}/storeys", tags=["storeys"])


@router.get("", response_model=list[StoreyRead])
async def list_storeys(
    project_id: UUID,
    model_id: UUID,
    response: Response,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Storey]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    model = (
        await session.execute(
            select(Model).where(Model.id == model_id, Model.project_id == project.id)
        )
    ).scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MODEL_NOT_FOUND")

    stmt = select(Storey).where(Storey.model_id == model_id, Storey.deleted_at.is_(None))
    total = (await session.scalar(select(func.count()).select_from(stmt.subquery()))) or 0
    set_total_count(response, total)

    # Ascending by floor: ordering then elevation (ASC sorts NULLs last in
    # Postgres), id as the stable tiebreaker.
    stmt = stmt.order_by(Storey.ordering.asc(), Storey.elevation_m.asc(), Storey.id.asc())
    return list((await session.execute(stmt)).scalars().all())


__all__ = ["router"]
