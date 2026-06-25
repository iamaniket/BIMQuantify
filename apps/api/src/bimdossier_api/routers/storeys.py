"""Read-only listing of a 3D document's storeys (levels).

Storeys are populated from the document's IFC extraction (see the processor +
``jobs_internal`` ingest); there is no write API — they are derived data. The
list is the anchor source for the aligned-sheet calibration UI (pick a floor)
and, later, for level-keyed findings.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.access import load_project_or_404, require_project_read_access
from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.models.document import Document
from bimdossier_api.models.storeys import Storey
from bimdossier_api.models.user import User
from bimdossier_api.pagination import set_total_count
from bimdossier_api.schemas.storey import StoreyRead
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(
    prefix="/projects/{project_id}/documents/{document_id}/storeys", tags=["storeys"]
)


@router.get("", response_model=list[StoreyRead])
async def list_storeys(
    project_id: UUID,
    document_id: UUID,
    response: Response,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[Storey]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    document = (
        await session.execute(
            select(Document).where(
                Document.id == document_id, Document.project_id == project.id
            )
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DOCUMENT_NOT_FOUND")

    stmt = select(Storey).where(
        Storey.document_id == document_id, Storey.deleted_at.is_(None)
    )
    total = (await session.scalar(select(func.count()).select_from(stmt.subquery()))) or 0
    set_total_count(response, total)

    # Ascending by floor: ordering then elevation (ASC sorts NULLs last in
    # Postgres), id as the stable tiebreaker.
    stmt = stmt.order_by(Storey.ordering.asc(), Storey.elevation_m.asc(), Storey.id.asc())
    return list((await session.execute(stmt)).scalars().all())


__all__ = ["router"]
