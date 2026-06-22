"""Org-wide (cross-project) deadline aggregation for the calendar.

Read-only endpoints that aggregate every deadline the caller can see across
all projects in the active org — powering the portal's org-level Calendar
route (Overview KPIs/charts + month grid). Scoped to the active org's schema
(the schema *is* the tenant boundary, so there is no cross-org leakage and no
``organization_id`` column). Visibility mirrors the project list: members see
their own projects, org admins / superusers see every project in the org.

``is_overdue`` and ``days_until_due`` are computed at read time in
Europe/Amsterdam — same convention as the per-project deadlines router.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.access import is_org_admin
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.i18n.request import resolve_request_locale
from bimstitch_api.jurisdictions import DeadlineRule, get_deadline_rules, pick_label
from bimstitch_api.models.deadline import Deadline, DeadlineStatus
from bimstitch_api.models.project import Project, ProjectLifecycleState
from bimstitch_api.models.project_member import ProjectMember
from bimstitch_api.models.user import User
from bimstitch_api.pagination import set_total_count
from bimstitch_api.schemas.deadline import (
    CalendarDeadlineRead,
    DeadlineSummaryRead,
    DeadlineWeekBucket,
)
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/deadlines", tags=["calendar"])

_AMS = ZoneInfo("Europe/Amsterdam")

# Projects the caller may see (soft-deleted/removed excluded).
_VISIBLE_STATES = (ProjectLifecycleState.active, ProjectLifecycleState.archived)

# Inclusive day ranges from today for the Overview "upcoming" bar chart.
_WEEK_BUCKETS: tuple[tuple[int, int], ...] = ((0, 7), (8, 14), (15, 21), (22, 30))


async def _is_unrestricted(
    session: AsyncSession, user: User, active_org_id: UUID
) -> bool:
    """True when the caller sees every project in the org (superuser/org admin)."""
    return user.is_superuser or await is_org_admin(session, user.id, active_org_id)


def _visible_stmt(selectables: tuple[Any, ...], *, unrestricted: bool, user_id: UUID) -> Any:
    """Build a SELECT over deadlines joined to their project, scoped to the
    caller's visibility. Non-admins are constrained to projects they are a
    member of via the ``ProjectMember`` join."""
    stmt = (
        select(*selectables)
        .join(Project, Project.id == Deadline.project_id)
        .where(Project.lifecycle_state.in_(_VISIBLE_STATES))
    )
    if not unrestricted:
        stmt = stmt.join(ProjectMember, ProjectMember.project_id == Project.id).where(
            ProjectMember.user_id == user_id
        )
    return stmt


def _rule_for(
    country: str,
    deadline_type: str,
    cache: dict[str, dict[str, DeadlineRule]],
) -> DeadlineRule | None:
    by_type = cache.get(country)
    if by_type is None:
        by_type = {r.deadline_type: r for r in get_deadline_rules(country)}
        cache[country] = by_type
    return by_type.get(deadline_type)


def _serialize(
    dl: Deadline,
    project: Project,
    locale: str,
    today: Any,
    cache: dict[str, dict[str, DeadlineRule]],
) -> CalendarDeadlineRead:
    rule = _rule_for(project.country, dl.deadline_type, cache)
    label = pick_label(rule.label, locale, "nl") if rule is not None else dl.deadline_type
    is_overdue = (
        dl.status == DeadlineStatus.pending
        and dl.due_date is not None
        and dl.due_date < today
    )
    days_until_due = (dl.due_date - today).days if dl.due_date is not None else None
    return CalendarDeadlineRead(
        id=dl.id,
        project_id=dl.project_id,
        project_name=project.name,
        country=project.country,
        deadline_type=dl.deadline_type,
        label=label,
        legal_reference=rule.legal_reference if rule is not None else None,
        due_date=dl.due_date,
        status=dl.status,
        is_overdue=is_overdue,
        days_until_due=days_until_due,
    )


@router.get("/summary", response_model=DeadlineSummaryRead)
async def org_deadline_summary(
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> DeadlineSummaryRead:
    """Aggregate counts across every deadline the caller can see in the org."""
    today = datetime.now(_AMS).date()
    unrestricted = await _is_unrestricted(session, user, active_org_id)
    stmt = _visible_stmt(
        (Deadline.status, Deadline.due_date), unrestricted=unrestricted, user_id=user.id
    )
    rows = (await session.execute(stmt)).all()

    total = len(rows)
    pending = met = not_applicable = overdue = due_this_week = 0
    bucket_counts = [0 for _ in _WEEK_BUCKETS]

    for dl_status, due_date in rows:
        if dl_status == DeadlineStatus.met:
            met += 1
            continue
        if dl_status == DeadlineStatus.not_applicable:
            not_applicable += 1
            continue
        # pending
        pending += 1
        if due_date is None:
            continue
        days = (due_date - today).days
        if days < 0:
            overdue += 1
            continue
        if days <= 7:
            due_this_week += 1
        for i, (lo, hi) in enumerate(_WEEK_BUCKETS):
            if lo <= days <= hi:
                bucket_counts[i] += 1
                break

    buckets = [
        DeadlineWeekBucket(days_from=lo, days_to=hi, count=bucket_counts[i])
        for i, (lo, hi) in enumerate(_WEEK_BUCKETS)
    ]
    return DeadlineSummaryRead(
        total=total,
        pending=pending,
        met=met,
        not_applicable=not_applicable,
        overdue=overdue,
        due_this_week=due_this_week,
        upcoming_buckets=buckets,
    )


@router.get("", response_model=list[CalendarDeadlineRead])
async def list_org_deadlines(
    request: Request,
    response: Response,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[CalendarDeadlineRead]:
    """Every deadline the caller can see, ranked by closeness (soonest first)."""
    locale = resolve_request_locale(request, user)
    today = datetime.now(_AMS).date()
    unrestricted = await _is_unrestricted(session, user, active_org_id)

    count_base = _visible_stmt(
        (Deadline.id,), unrestricted=unrestricted, user_id=user.id
    )
    total = (
        await session.scalar(select(func.count()).select_from(count_base.subquery()))
    ) or 0
    set_total_count(response, total)

    base = _visible_stmt((Deadline, Project), unrestricted=unrestricted, user_id=user.id)
    rows = (
        await session.execute(
            base.order_by(Deadline.due_date.asc().nulls_last(), Deadline.id.asc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    cache: dict[str, dict[str, DeadlineRule]] = {}
    return [_serialize(dl, project, locale, today, cache) for dl, project in rows]
