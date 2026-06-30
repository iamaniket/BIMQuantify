"""Free-tier project activity timeline — derived from existing free-table rows.

The free wedge records NO audit_log (that table is tenant-scoped and unreachable
from a free `get_free_session`, which runs `search_path = public`). So unlike the
paid feed (`routers/activity.py`, backed by `audit_log`), there is no event store
to read. Instead we SYNTHESIZE the activity-over-time trend from the timestamps
that already live on the pooled free tables:

  * `pooled_documents.created_at`            → create / document
  * `pooled_project_files.created_at`        → upload / project_file
  * `pooled_project_files.extraction_finished_at` (terminal) → scan / project_file
  * `pooled_findings.created_at`             → create / finding
  * `pooled_findings.updated_at` (> created) → change / finding
  * `pooled_project_members.created_at`      → change / project_member

The category/resource vocabulary is identical to the paid feed, so the portal's
`ActivityTimelinePanel` card + `ActivityTrendTooltip` render free rows unchanged
(the panel branches its fetch path on `free` via `lib/api/scope.ts`).

Surface is the trend CARD only — there is intentionally no list/`""` endpoint and
no `/free/projects/{id}/activity` page (a derived feed has no per-event rows, no
before/after diffs, and "change" is approximate: one marker per row's last
`updated_at`, not per edit). Flag-gated like the rest of `/free/*`; a non-
participant gets 404 (RLS also scopes every query rows-wise).
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.fastapi_users import current_verified_user
from bimdossier_api.models.free_document import PooledDocument
from bimdossier_api.models.free_finding import PooledFinding
from bimdossier_api.models.free_project_file import PooledProjectFile
from bimdossier_api.models.free_project_member import PooledProjectMember
from bimdossier_api.models.project_file import ExtractionStatus
from bimdossier_api.models.user import User
from bimdossier_api.routers.free_access import require_free_tier_enabled, resolve_free_role
from bimdossier_api.schemas.activity import ActivityTimelineBucket
from bimdossier_api.tenancy import get_free_session

router = APIRouter(
    prefix="/free/projects/{project_id}/activity",
    tags=["free", "activity"],
    dependencies=[Depends(require_free_tier_enabled)],
)

# Extraction reaching a terminal state is the free analog of the paid
# `project_file.extraction_{succeeded,failed}` "scan" events.
_SCAN_STATUSES: tuple[str, ...] = (ExtractionStatus.succeeded.value, ExtractionStatus.failed.value)


@dataclass
class _BucketAcc:
    """Running tally for one timeline bucket while folding the per-source counts."""

    count: int = 0
    by_category: defaultdict[str, int] = field(default_factory=lambda: defaultdict(int))
    by_resource: defaultdict[str, int] = field(default_factory=lambda: defaultdict(int))


async def compute_free_activity_timeline(
    session: AsyncSession,
    project_id: UUID,
    *,
    bucket: str = "week",
    since: datetime | None = None,
) -> list[ActivityTimelineBucket]:
    """Build the free project's activity-over-time buckets from existing rows.

    Mirrors the OUTPUT of the paid `compute_activity_timeline` (same
    ``ActivityTimelineBucket`` shape, same category/resource keys, non-empty
    buckets ascending by ``bucket_start``) so the portal card is identical — only
    the SOURCE differs (synthesized per-table counts instead of ``audit_log``).
    The CALLER owns the access check; this only runs the queries. RLS scopes every
    query to the caller's accessible rows.
    """
    grain = "week" if bucket == "week" else "day"
    since_aware: datetime | None = None
    if since is not None:
        since_aware = since if since.tzinfo is not None else since.replace(tzinfo=UTC)

    # Files / findings reach the project through their parent container; resolve
    # the project's document ids once and key off it (RLS-scoped subquery).
    doc_ids = (
        select(PooledDocument.id).where(PooledDocument.pooled_project_id == project_id).scalar_subquery()
    )

    buckets: dict[datetime, _BucketAcc] = {}

    async def _fold(ts_col: Any, *filters: Any, category: str, resource: str) -> None:
        """Run a ``date_trunc`` grouped count over one source and fold it in."""
        bucket_col = func.date_trunc(grain, ts_col).label("bucket_start")
        stmt = select(bucket_col, func.count().label("n")).where(*filters)
        if since_aware is not None:
            stmt = stmt.where(ts_col >= since_aware)
        stmt = stmt.group_by(bucket_col)
        for row in (await session.execute(stmt)).all():
            if row.bucket_start is None:
                continue
            acc = buckets.setdefault(row.bucket_start, _BucketAcc())
            acc.count += row.n
            acc.by_category[category] += row.n
            acc.by_resource[resource] += row.n

    await _fold(
        PooledDocument.created_at,
        PooledDocument.pooled_project_id == project_id,
        category="create",
        resource="document",
    )
    await _fold(
        PooledProjectFile.created_at,
        PooledProjectFile.pooled_document_id.in_(doc_ids),
        category="upload",
        resource="project_file",
    )
    await _fold(
        PooledProjectFile.extraction_finished_at,
        PooledProjectFile.pooled_document_id.in_(doc_ids),
        PooledProjectFile.extraction_finished_at.is_not(None),
        PooledProjectFile.extraction_status.in_(_SCAN_STATUSES),
        category="scan",
        resource="project_file",
    )
    await _fold(
        PooledFinding.created_at,
        PooledFinding.pooled_document_id.in_(doc_ids),
        category="create",
        resource="finding",
    )
    await _fold(
        PooledFinding.updated_at,
        PooledFinding.pooled_document_id.in_(doc_ids),
        PooledFinding.updated_at > PooledFinding.created_at,
        category="change",
        resource="finding",
    )
    await _fold(
        PooledProjectMember.created_at,
        PooledProjectMember.pooled_project_id == project_id,
        category="change",
        resource="project_member",
    )

    return [
        ActivityTimelineBucket(
            bucket_start=bucket_start,
            count=buckets[bucket_start].count,
            by_category=dict(buckets[bucket_start].by_category),
            by_resource=dict(buckets[bucket_start].by_resource),
        )
        for bucket_start in sorted(buckets)
    ]


@router.get("/timeline", response_model=list[ActivityTimelineBucket])
async def free_project_activity_timeline(
    project_id: UUID,
    bucket: str = Query(default="week", pattern="^(day|week)$"),
    since: datetime | None = Query(default=None),
    session: AsyncSession = Depends(get_free_session),
    user: User = Depends(current_verified_user),
) -> list[ActivityTimelineBucket]:
    """Activity-over-time trend for a free project's detail-page card.

    Gates on participation (owner or member) — ``None`` role → 404 — then
    delegates to :func:`compute_free_activity_timeline`. Not paginated.
    """
    role = await resolve_free_role(session, project_id, user.id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FREE_PROJECT_NOT_FOUND")
    return await compute_free_activity_timeline(session, project_id, bucket=bucket, since=since)


__all__ = ["compute_free_activity_timeline", "router"]
