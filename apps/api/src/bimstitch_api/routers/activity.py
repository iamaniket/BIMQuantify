"""Project-scoped activity feed backed by audit_log.

Returns categorized audit entries for a project. `audit_log` is a per-tenant
table, so the tenant session's search_path resolves it to the active org's
schema — org scoping is physical, not an RLS/organization_id filter. Any
project member can read; org admins and superusers bypass the membership check.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import Select, func, select
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
from bimstitch_api.schemas.activity import ActivityTimelineBucket, ProjectActivityEntry
from bimstitch_api.tenancy import get_tenant_session, require_active_organization

router = APIRouter(prefix="/projects/{project_id}/activity", tags=["activity"])

# The feed surfaces EVERY project-scoped audit row (so new event types appear
# automatically) except a small denylist of noisy "upload started" rows — the
# terminal completed/rejected row is the one worth showing. The category
# badge/filter is derived from the action: a curated upload/scan set is checked
# first, then a `.created`/`.deleted` suffix rule buckets every entity's create
# and delete events, with everything else (updates, risks, bcf, plan edits, …)
# falling through to the "change" catch-all. Suffix-after-curated ordering keeps
# the two intentional exceptions in place: report.created stays "scan" and
# project_file.deleted stays "upload".
_UPLOAD_ACTIONS: frozenset[str] = frozenset(
    {
        "project_file.completed",
        "project_file.rejected",
        "project_file.deleted",
        "project_file.version_restored",
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


@dataclass
class _BucketAccumulator:
    """Mutable running tally for one timeline bucket while folding the grouped
    ``(bucket, action, resource_type)`` rows back up to a single entry."""

    count: int = 0
    by_category: defaultdict[str, int] = field(default_factory=lambda: defaultdict(int))
    by_resource: defaultdict[str, int] = field(default_factory=lambda: defaultdict(int))


def _category_for(action: str) -> str:
    """Map an audit action to a feed category. Unknown/new actions resolve to
    'change' — the catch-all bucket — so they show without code changes."""
    if action in _UPLOAD_ACTIONS:
        return "upload"
    if action in _SCAN_ACTIONS:
        return "scan"
    if action.endswith(".created"):
        return "create"
    if action.endswith(".deleted"):
        return "delete"
    return "change"


def _apply_category_filter(stmt: Select[Any], category: str | None) -> Select[Any]:
    """Narrow a SELECT over ``AuditLog`` to one feed category.

    The SQL mirror of :func:`_category_for`, shared by the list and timeline
    endpoints so the two bucket identically (curated upload/scan sets first,
    then a ``.created``/``.deleted`` suffix rule, with everything else falling
    through to 'change'). A ``None`` category is a no-op.
    """
    if category == "upload":
        return stmt.where(AuditLog.action.in_(_UPLOAD_ACTIONS))
    if category == "scan":
        return stmt.where(AuditLog.action.in_(_SCAN_ACTIONS))
    if category == "create":
        # A `.created` action that isn't a curated upload/scan (report.created
        # stays "scan").
        return stmt.where(
            AuditLog.action.notin_(_UPLOAD_ACTIONS | _SCAN_ACTIONS),
            AuditLog.action.like("%.created"),
        )
    if category == "delete":
        # A `.deleted` action that isn't a curated upload/scan (project_file.deleted
        # stays "upload").
        return stmt.where(
            AuditLog.action.notin_(_UPLOAD_ACTIONS | _SCAN_ACTIONS),
            AuditLog.action.like("%.deleted"),
        )
    if category == "change":
        # The catch-all bucket: everything that isn't an upload, scan, create,
        # or delete.
        return stmt.where(
            AuditLog.action.notin_(_UPLOAD_ACTIONS | _SCAN_ACTIONS),
            AuditLog.action.notlike("%.created"),
            AuditLog.action.notlike("%.deleted"),
        )
    return stmt


@router.get("", response_model=list[ProjectActivityEntry])
async def list_project_activity(
    project_id: UUID,
    response: Response,
    category: str | None = Query(default=None, pattern="^(upload|scan|create|change|delete)$"),
    since: datetime | None = Query(default=None),
    limit: int = Query(default=20, ge=20, le=100),
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

    base = _apply_category_filter(base, category)

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


@router.get("/timeline", response_model=list[ActivityTimelineBucket])
async def project_activity_timeline(
    project_id: UUID,
    bucket: str = Query(default="day", pattern="^(day|week)$"),
    since: datetime | None = Query(default=None),
    category: str | None = Query(default=None, pattern="^(upload|scan|create|change|delete)$"),
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
    active_org_id: UUID = Depends(require_active_organization),
) -> list[ActivityTimelineBucket]:
    """Activity-over-time trend for a project's feed.

    Counts feed events grouped into ``day`` or ``week`` buckets, sharing the
    list endpoint's scoping (same project + ``_EXCLUDED_ACTIONS`` denylist +
    category mapping) so the chart matches the table. Returns only buckets with
    at least one event, ascending by ``bucket_start`` — the client zero-fills
    gaps over its fixed time axis. Not paginated (no ``X-Total-Count``).

    Each bucket also carries ``by_category`` / ``by_resource`` breakdowns. We
    group by ``(bucket, action, resource_type)`` and fold in Python through
    :func:`_category_for`, so the category mapping has a single source of truth
    (no second SQL mirror to drift). The grouped result set is tiny — at most
    ``distinct actions x resource types x buckets`` rows.
    """
    project = await load_project_or_404(session, project_id)
    await require_project_read_access(session, project.id, user, active_org_id)

    grain = "week" if bucket == "week" else "day"
    bucket_col = func.date_trunc(grain, AuditLog.created_at).label("bucket_start")

    stmt = select(
        bucket_col,
        AuditLog.action,
        AuditLog.resource_type,
        # Label "n", not "count": a SQLAlchemy Row is tuple-like, so a "count"
        # label collides with tuple.count and mypy reads row.count as a method.
        func.count().label("n"),
    ).where(
        AuditLog.project_id == project.id,
        AuditLog.action.notin_(_EXCLUDED_ACTIONS),
    )
    stmt = _apply_category_filter(stmt, category)

    if since is not None:
        since_aware = since if since.tzinfo is not None else since.replace(tzinfo=timezone.utc)
        stmt = stmt.where(AuditLog.created_at >= since_aware)

    stmt = stmt.group_by(bucket_col, AuditLog.action, AuditLog.resource_type).order_by(
        bucket_col.asc()
    )
    rows = (await session.execute(stmt)).all()

    # Fold the (bucket, action, resource_type) grain back up to one entry per
    # bucket. Rows arrive ascending by bucket_start, so first-seen order is the
    # ascending bucket order the client expects.
    buckets: dict[datetime, _BucketAccumulator] = {}
    order: list[datetime] = []
    for row in rows:
        acc = buckets.get(row.bucket_start)
        if acc is None:
            acc = _BucketAccumulator()
            buckets[row.bucket_start] = acc
            order.append(row.bucket_start)
        acc.count += row.n
        acc.by_category[_category_for(row.action)] += row.n
        acc.by_resource[row.resource_type] += row.n

    return [
        ActivityTimelineBucket(
            bucket_start=bucket_start,
            count=buckets[bucket_start].count,
            by_category=dict(buckets[bucket_start].by_category),
            by_resource=dict(buckets[bucket_start].by_resource),
        )
        for bucket_start in order
    ]


__all__ = ["router"]
