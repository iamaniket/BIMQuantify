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

# The feed surfaces EVERY project-scoped audit row (so new event types appear
# automatically) except a small denylist of noisy "upload started" rows — the
# terminal completed/rejected row is the one worth showing. The category
# badge/filter is derived from the action: a curated upload/scan set, with
# everything else (findings, risks, bcf, plan edits, project edits, …) falling
# through to the "change" catch-all.
_UPLOAD_ACTIONS: frozenset[str] = frozenset(
    {
        "project_file.completed",
        "project_file.rejected",
        "project_file.deleted",
        "attachment.completed",
        "attachment.rejected",
        "certificate.completed",
        "certificate.rejected",
        "certificate.version_added",
        "certificate.linked_from_library",
    }
)
_SCAN_ACTIONS: frozenset[str] = frozenset(
    {
        "project_file.extraction_succeeded",
        "project_file.extraction_failed",
        "compliance.checked",
        "report.created",
        "report.signed",
    }
)
_EXCLUDED_ACTIONS: frozenset[str] = frozenset(
    {
        "project_file.initiated",
        "attachment.initiated",
        "certificate.initiated",
    }
)


def _category_for(action: str) -> str:
    """Map an audit action to a feed category. Unknown/new actions resolve to
    'change' — the catch-all bucket — so they show without code changes."""
    if action in _UPLOAD_ACTIONS:
        return "upload"
    if action in _SCAN_ACTIONS:
        return "scan"
    return "change"


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
            AuditLog.action.notin_(_EXCLUDED_ACTIONS),
        )
    )

    if category == "upload":
        base = base.where(AuditLog.action.in_(_UPLOAD_ACTIONS))
    elif category == "scan":
        base = base.where(AuditLog.action.in_(_SCAN_ACTIONS))
    elif category == "change":
        # The catch-all bucket: everything that isn't an upload or a scan.
        base = base.where(AuditLog.action.notin_(_UPLOAD_ACTIONS | _SCAN_ACTIONS))

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
            category=_category_for(row.action),
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
