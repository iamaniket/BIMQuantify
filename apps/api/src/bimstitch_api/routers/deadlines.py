"""Per-project deadline endpoints.

System-managed deadlines — users cannot create or delete them. The
`recompute_deadlines()` service upserts rows on project create and
whenever date fields change. Users can only list/get deadlines and
mark them as met.

`is_overdue` is computed at read time (status == pending AND due_date < today
in Europe/Amsterdam timezone) — no background cron needed.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.auth.permissions import Action, Resource, require_permission
from bimstitch_api.models.deadline import Deadline, DeadlineStatus
from bimstitch_api.models.user import User
from bimstitch_api.routers.projects import (
    _load_project_or_404,
    _require_membership,
    _require_project_read_access,
)
from bimstitch_api.schemas.deadline import DeadlineRead
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/deadlines", tags=["deadlines"])

_AMS = ZoneInfo("Europe/Amsterdam")


def _serialize_deadline(dl: Deadline) -> DeadlineRead:
    """Build a DeadlineRead with the computed is_overdue flag."""
    today = datetime.now(_AMS).date()
    is_overdue = (
        dl.status == DeadlineStatus.pending
        and dl.due_date is not None
        and dl.due_date < today
    )
    return DeadlineRead(
        id=dl.id,
        project_id=dl.project_id,
        deadline_type=dl.deadline_type,
        due_date=dl.due_date,
        status=dl.status,
        met_at=dl.met_at,
        met_by_user_id=dl.met_by_user_id,
        is_overdue=is_overdue,
        created_at=dl.created_at,
        updated_at=dl.updated_at,
    )


async def _load_deadline_or_404(
    session: AsyncSession, project_id: UUID, deadline_id: UUID
) -> Deadline:
    dl = (
        await session.execute(
            select(Deadline).where(
                Deadline.id == deadline_id, Deadline.project_id == project_id
            )
        )
    ).scalar_one_or_none()
    if dl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="DEADLINE_NOT_FOUND"
        )
    return dl


@router.get("", response_model=list[DeadlineRead])
async def list_deadlines(
    project_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[DeadlineRead]:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)

    result = await session.execute(
        select(Deadline)
        .where(Deadline.project_id == project.id)
        .order_by(Deadline.due_date.asc().nulls_last())
    )
    return [_serialize_deadline(dl) for dl in result.scalars().all()]


@router.get("/{deadline_id}", response_model=DeadlineRead)
async def get_deadline(
    project_id: UUID,
    deadline_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> DeadlineRead:
    project = await _load_project_or_404(session, project_id)
    await _require_project_read_access(session, project.id, user, active_org_id)
    dl = await _load_deadline_or_404(session, project.id, deadline_id)
    return _serialize_deadline(dl)


@router.patch("/{deadline_id}", response_model=DeadlineRead)
async def mark_deadline_met(
    project_id: UUID,
    deadline_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> DeadlineRead:
    """Mark a pending deadline as met.

    Idempotent: calling on an already-met deadline is a no-op 200.
    Rejects not_applicable deadlines (there's nothing to mark).
    """
    project = await _load_project_or_404(session, project_id)
    membership = await _require_membership(session, project.id, user.id)
    require_permission(membership.role, Resource.deadline, Action.update)

    dl = await _load_deadline_or_404(session, project.id, deadline_id)

    if dl.status == DeadlineStatus.not_applicable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="DEADLINE_NOT_APPLICABLE",
        )

    if dl.status == DeadlineStatus.pending:
        dl.status = DeadlineStatus.met
        dl.met_at = datetime.now(_AMS)
        dl.met_by_user_id = user.id
        await session.flush()
        await session.refresh(dl)

    # Already met → idempotent, return current state
    return _serialize_deadline(dl)
