"""Project-scoped activity feed backed by audit_log.

Returns categorized audit entries for a project. `audit_log` is a per-tenant
table, so the tenant session's search_path resolves it to the active org's
schema — org scoping is physical, not an RLS/organization_id filter. Any
project member can read; org admins and superusers bypass the membership check.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.access import (
    load_project_or_404,
    require_project_read_access,
)
from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.models.audit_log import AuditLog
from bimstitch_api.models.user import User
from bimstitch_api.pagination import (
    SortParams,
    apply_sort,
    count_query,
    set_total_count,
    sort_params,
)
from bimstitch_api.schemas.activity import ProjectActivityEntry
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/activity", tags=["activity"])

_CATEGORY_MAP: dict[str, str] = {
    "model.created": "change",
    "model.updated": "change",
    "model.deleted": "change",
    "project_file.completed": "upload",
    "project_file.rejected": "upload",
    "project_file.deleted": "upload",
    "project_file.extraction_succeeded": "scan",
    "project_file.extraction_failed": "scan",
    "compliance.checked": "scan",
    "report.created": "scan",
    "attachment.completed": "upload",
    "attachment.rejected": "upload",
    "attachment.updated": "change",
    "attachment.deleted": "change",
}

_KNOWN_ACTIONS = set(_CATEGORY_MAP.keys())

_CATEGORY_ACTIONS: dict[str, list[str]] = {}
for _action, _cat in _CATEGORY_MAP.items():
    _CATEGORY_ACTIONS.setdefault(_cat, []).append(_action)


@router.get("", response_model=list[ProjectActivityEntry])
async def list_project_activity(
    project_id: UUID,
    response: Response,
    category: str | None = Query(default=None, pattern="^(upload|scan|change)$"),
    since: datetime | None = Query(default=None),
    limit: int = Query(default=25, ge=25, le=100),
    offset: int = Query(default=0, ge=0),
    sort: SortParams = Depends(sort_params),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[ProjectActivityEntry]:
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    # One base SELECT carries every filter; the count and the page read from it,
    # so the WHERE clauses can't drift between the two.
    base = (
        select(
            AuditLog.id,
            AuditLog.action,
            AuditLog.user_id.label("actor_user_id"),
            User.full_name.label("actor_name"),
            AuditLog.resource_type,
            AuditLog.resource_id,
            AuditLog.before,
            AuditLog.after,
            AuditLog.created_at,
        )
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            AuditLog.project_id == project.id,
            AuditLog.action.in_(_KNOWN_ACTIONS),
        )
    )

    if category is not None:
        base = base.where(AuditLog.action.in_(_CATEGORY_ACTIONS.get(category, [])))

    if since is not None:
        since_aware = since if since.tzinfo is not None else since.replace(tzinfo=timezone.utc)
        base = base.where(AuditLog.created_at >= since_aware)

    set_total_count(response, await count_query(session, base))

    # Whitelisted sort: date (created_at) and type (action, the dotted code that
    # clusters events by kind). id tiebreaker keeps offset paging deterministic.
    stmt = (
        apply_sort(
            base,
            sort,
            {"created_at": AuditLog.created_at, "action": AuditLog.action},
            default="created_at",
            default_dir="desc",
            tiebreaker=AuditLog.id,
        )
        .limit(limit)
        .offset(offset)
    )

    rows = (await session.execute(stmt)).all()

    return [
        ProjectActivityEntry(
            id=row.id,
            action=row.action,
            category=_CATEGORY_MAP.get(row.action, "change"),
            actor_user_id=row.actor_user_id,
            actor_name=row.actor_name,
            resource_type=row.resource_type,
            resource_id=row.resource_id,
            before=row.before,
            after=row.after,
            created_at=row.created_at,
        )
        for row in rows
    ]


__all__ = ["router"]
