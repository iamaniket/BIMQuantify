"""Element-to-inspection lookup endpoint (backlog #49).

Given a project, file, and IFC element ``global_id``, returns all checklist
items linked to that element — together with their inspection results (if
any) and parent borgingsmoment context.  This powers the viewer's
"Inspections" side-panel.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.models.checklist_item import ChecklistItem

if TYPE_CHECKING:
    from bimdossier_api.models.borgingsmoment import Borgingsmoment
from bimdossier_api.access import (
    load_project_or_404,
    require_project_read_access,
)
from bimdossier_api.models.checklist_item_result import ChecklistItemResult
from bimdossier_api.models.user import User
from bimdossier_api.schemas.element_inspections import (
    ElementInspectionItem,
    ElementInspectionsResponse,
)
from bimdossier_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(tags=["element-inspections"])


@router.get(
    "/projects/{project_id}/files/{file_id}/element-inspections",
    response_model=ElementInspectionsResponse,
)
async def get_element_inspections(
    project_id: UUID,
    file_id: UUID,
    global_id: str = Query(..., min_length=1, max_length=22),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> ElementInspectionsResponse:
    """Return all checklist items linked to a specific IFC element."""

    # Verify project exists + caller has read access.
    await load_project_or_404(session, project_id)
    await require_project_read_access(session, project_id, user, active_org_id)

    # Query checklist items linked to this element, eager-loading their
    # moment for context. Left-join results so uninspected items surface
    # with ``result=None``.
    stmt = (
        select(ChecklistItem)
        .options(selectinload(ChecklistItem.moment))
        .where(
            ChecklistItem.project_id == project_id,
            ChecklistItem.linked_file_id == file_id,
            ChecklistItem.linked_element_global_id == global_id,
        )
        .order_by(ChecklistItem.sequence)
    )
    items = (await session.execute(stmt)).scalars().all()

    if not items:
        return ElementInspectionsResponse(
            items=[],
            element_global_id=global_id,
            file_id=file_id,
        )

    # Batch-fetch results for all matched checklist items in one query.
    item_ids = [item.id for item in items]
    results_stmt = select(ChecklistItemResult).where(
        ChecklistItemResult.checklist_item_id.in_(item_ids),
    )
    results = (await session.execute(results_stmt)).scalars().all()
    result_by_item = {r.checklist_item_id: r for r in results}

    response_items: list[ElementInspectionItem] = []
    for item in items:
        moment: Borgingsmoment = item.moment
        response_items.append(
            ElementInspectionItem(
                checklist_item=item,  # type: ignore[arg-type]
                result=result_by_item.get(item.id),  # type: ignore[arg-type]
                moment_name=moment.name,
                moment_phase=moment.phase,
                moment_status=moment.status,
            )
        )

    return ElementInspectionsResponse(
        items=response_items,
        element_global_id=global_id,
        file_id=file_id,
    )
