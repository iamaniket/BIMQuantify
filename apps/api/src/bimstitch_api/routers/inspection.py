"""Inspection execution endpoints.

Wkb MVP backlog #19. During a borgingsmoment inspection the kwaliteitsborger
walks through each checklist item, recording a pass/fail/not_applicable
verdict. These endpoints manage that flow:

  start-inspection    — transition moment planned → in_progress
  submit result       — upsert one verdict per checklist item
  list results        — restore progress on reconnect
  inspection-summary  — progress counts for the progress bar
  complete-inspection — finalize moment → passed or failed
"""

from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from bimstitch_api import audit
from bimstitch_api.attachment_links import replace_attachment_links
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.models.borgingsmoment import Borgingsmoment, BorgingsmomentStatus
from bimstitch_api.models.checklist_item import ChecklistItem
from bimstitch_api.models.checklist_item_result import (
    ChecklistItemResult,
    InspectionVerdict,
)
from bimstitch_api.models.checklist_item_result_attachment import (
    ChecklistItemResultAttachment,
)
from bimstitch_api.models.user import User
from bimstitch_api.routers.borgingsplan import (
    _load_moment_by_id_or_404,
    _walk_to_project_via_moment,
)
from bimstitch_api.routers.projects import (
    _require_membership,
    _require_project_writable,
)
from bimstitch_api.schemas.borgingsplan import BorgingsmomentRead
from bimstitch_api.schemas.inspection import (
    ChecklistItemResultRead,
    InspectionSummaryRead,
    ResultCreate,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(tags=["inspection"])

_TERMINAL_STATUSES = frozenset({
    BorgingsmomentStatus.passed,
    BorgingsmomentStatus.failed,
    BorgingsmomentStatus.skipped,
})


async def _require_moment_writable(
    session: AsyncSession, moment_id: UUID, user: User,
) -> tuple[Borgingsmoment, UUID]:
    moment = await _load_moment_by_id_or_404(session, moment_id)
    project, _plan = await _walk_to_project_via_moment(session, moment)
    _require_project_writable(project)
    membership = await _require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.inspection, Action.update)
    return moment, project.id


async def _require_moment_readable(
    session: AsyncSession, moment_id: UUID, user: User,
) -> tuple[Borgingsmoment, UUID]:
    moment = await _load_moment_by_id_or_404(session, moment_id)
    project, _plan = await _walk_to_project_via_moment(session, moment)
    await _require_membership(session, project.id, user.id)
    return moment, project.id


@router.post(
    "/borgingsmomenten/{moment_id}/start-inspection",
    response_model=BorgingsmomentRead,
)
async def start_inspection(
    moment_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Borgingsmoment:
    moment, project_id = await _require_moment_writable(session, moment_id, user)

    if moment.status in _TERMINAL_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="MOMENT_ALREADY_COMPLETED",
        )

    if moment.status is BorgingsmomentStatus.planned:
        moment.status = BorgingsmomentStatus.in_progress
        moment.actual_date = date.today()
        await session.flush()
        await audit.record(
            session,
            action="inspection.started",
            resource_type="borgingsmoment",
            resource_id=moment.id,
            after={"moment_id": str(moment.id), "inspector_user_id": str(user.id)},
            actor_user_id=user.id,
            request=request,
        )

    return (
        await session.execute(
            select(Borgingsmoment)
            .options(selectinload(Borgingsmoment.checklist_items))
            .where(Borgingsmoment.id == moment.id)
        )
    ).scalar_one()


@router.post(
    "/borgingsmomenten/{moment_id}/checklist-items/{item_id}/result",
    response_model=ChecklistItemResultRead,
    status_code=status.HTTP_201_CREATED,
)
async def submit_result(
    moment_id: UUID,
    item_id: UUID,
    payload: ResultCreate,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> ChecklistItemResult:
    moment, project_id = await _require_moment_writable(session, moment_id, user)

    if moment.status in _TERMINAL_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="MOMENT_ALREADY_COMPLETED",
        )

    item = (
        await session.execute(
            select(ChecklistItem).where(
                ChecklistItem.id == item_id,
                ChecklistItem.borgingsmoment_id == moment_id,
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="CHECKLIST_ITEM_NOT_FOUND",
        )

    if (
        payload.verdict is InspectionVerdict.not_applicable
        and not payload.note
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="NVT_REQUIRES_NOTE",
        )

    existing = (
        await session.execute(
            select(ChecklistItemResult).where(
                ChecklistItemResult.checklist_item_id == item_id,
            )
        )
    ).scalar_one_or_none()

    if existing is not None:
        await session.execute(
            delete(ChecklistItemResult).where(
                ChecklistItemResult.id == existing.id,
            )
        )
        await session.flush()

    result = ChecklistItemResult(
        checklist_item_id=item_id,
        borgingsmoment_id=moment_id,
        project_id=project_id,
        verdict=payload.verdict,
        note=payload.note,
        inspector_user_id=user.id,
        inspected_at=datetime.now(UTC),
    )
    replace_attachment_links(
        result.attachment_links,
        ChecklistItemResultAttachment,
        kind="photo",
        ids=payload.photo_ids,
    )
    replace_attachment_links(
        result.attachment_links,
        ChecklistItemResultAttachment,
        kind="reference",
        ids=payload.reference_attachment_ids,
    )
    session.add(result)
    try:
        await session.flush()
    except IntegrityError as exc:
        # A photo/reference id that doesn't reference a real attachment trips the
        # FK — surface a clean 422 instead of a 500.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ATTACHMENT_NOT_FOUND",
        ) from exc
    # Re-fetch so the eager attachment links are populated (a freshly-built row
    # is not selectin-loaded) for both the audit snapshot and the response.
    result = (
        await session.execute(
            select(ChecklistItemResult).where(ChecklistItemResult.id == result.id)
        )
    ).scalar_one()
    await audit.record(
        session,
        action="inspection_result.submitted",
        resource_type="checklist_item_result",
        resource_id=result.id,
        after={
            "checklist_item_id": str(item_id),
            "verdict": result.verdict.value,
            "has_note": bool(result.note),
            "has_photos": bool(result.photo_ids),
            "has_references": bool(result.reference_attachment_ids),
        },
        actor_user_id=user.id,
        request=request,
    )
    return result


@router.get(
    "/borgingsmomenten/{moment_id}/results",
    response_model=list[ChecklistItemResultRead],
)
async def list_results(
    moment_id: UUID,
    response: Response,
    # Generous cap: the portal restores the full result set on reconnect.
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[ChecklistItemResult]:
    moment, _project_id = await _require_moment_readable(session, moment_id, user)

    base = (
        select(ChecklistItemResult)
        .where(ChecklistItemResult.borgingsmoment_id == moment.id)
        .join(
            ChecklistItem,
            ChecklistItemResult.checklist_item_id == ChecklistItem.id,
        )
    )
    total = (await session.scalar(select(func.count()).select_from(base.subquery()))) or 0
    response.headers["X-Total-Count"] = str(total)
    rows = (
        await session.execute(
            base.order_by(ChecklistItem.sequence).limit(limit).offset(offset)
        )
    ).scalars().all()
    return list(rows)


@router.get(
    "/borgingsmomenten/{moment_id}/inspection-summary",
    response_model=InspectionSummaryRead,
)
async def inspection_summary(
    moment_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> InspectionSummaryRead:
    moment, _project_id = await _require_moment_readable(session, moment_id, user)

    total_items = (
        await session.execute(
            select(func.count()).where(
                ChecklistItem.borgingsmoment_id == moment.id,
            )
        )
    ).scalar_one()

    results = (
        await session.execute(
            select(ChecklistItemResult.verdict).where(
                ChecklistItemResult.borgingsmoment_id == moment.id,
            )
        )
    ).scalars().all()

    passed = sum(1 for v in results if v == InspectionVerdict.pass_verdict)
    failed = sum(1 for v in results if v == InspectionVerdict.fail)
    na = sum(1 for v in results if v == InspectionVerdict.not_applicable)
    completed = len(results)

    return InspectionSummaryRead(
        total_items=total_items,
        completed=completed,
        passed=passed,
        failed=failed,
        not_applicable=na,
        remaining=total_items - completed,
    )


@router.post(
    "/borgingsmomenten/{moment_id}/complete-inspection",
    response_model=BorgingsmomentRead,
)
async def complete_inspection(
    moment_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> Borgingsmoment:
    moment, _project_id = await _require_moment_writable(session, moment_id, user)

    if moment.status is not BorgingsmomentStatus.in_progress:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="MOMENT_NOT_IN_PROGRESS",
        )

    total_items = (
        await session.execute(
            select(func.count()).where(
                ChecklistItem.borgingsmoment_id == moment.id,
            )
        )
    ).scalar_one()

    result_count = (
        await session.execute(
            select(func.count()).where(
                ChecklistItemResult.borgingsmoment_id == moment.id,
            )
        )
    ).scalar_one()

    if result_count < total_items:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="INCOMPLETE_INSPECTION",
        )

    has_failures = (
        await session.execute(
            select(func.count()).where(
                ChecklistItemResult.borgingsmoment_id == moment.id,
                ChecklistItemResult.verdict == InspectionVerdict.fail,
            )
        )
    ).scalar_one()

    final_status = BorgingsmomentStatus.failed if has_failures else BorgingsmomentStatus.passed
    moment.status = final_status
    await session.flush()

    await audit.record(
        session,
        action="inspection.completed",
        resource_type="borgingsmoment",
        resource_id=moment.id,
        before={"status": BorgingsmomentStatus.in_progress.value},
        after={
            "status": final_status.value,
            "total_items": total_items,
            "fail_count": int(has_failures),
        },
        actor_user_id=user.id,
        request=request,
    )

    return (
        await session.execute(
            select(Borgingsmoment)
            .options(selectinload(Borgingsmoment.checklist_items))
            .where(Borgingsmoment.id == moment.id)
        )
    ).scalar_one()
