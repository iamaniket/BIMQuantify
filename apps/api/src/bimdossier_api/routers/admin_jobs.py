"""Super-admin processor/extractor monitoring (cross-tenant, read-only).

Two endpoints, both gated by `require_superuser`:

- `GET /admin/jobs/active` — the live ongoing/stuck feed. The only DB query in
  the feature, and it only ever touches **non-terminal** jobs. It iterates every
  active org schema with `SET LOCAL search_path` (the same cross-tenant pattern
  as `jobs/reconcile.py::sweep_all_orgs`), bounded by `sweep_org_concurrency`.
  Non-terminal sets are tiny — at any instant most orgs have zero jobs in
  flight — so the fan-out is light and never scans job history.

- `GET /admin/processor/queue-stats` — proxies the processor's live BullMQ
  counts. Keeps the shared secret server-side (the browser never sees it).
"""

import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.orm import defer

from bimdossier_api.auth.dependencies import require_superuser
from bimdossier_api.background.concurrency import map_bounded
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.db import get_session_maker
from bimdossier_api.jobs.dispatcher import DispatchJobError, fetch_queue_stats
from bimdossier_api.jobs.reconcile import _STUCK_JOB_STATES
from bimdossier_api.models.job import Job
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.user import User
from bimdossier_api.schemas.admin_jobs import (
    AdminActiveJobs,
    AdminActiveJobsSummary,
    AdminJobItem,
    ProcessorQueueStats,
)
from bimdossier_api.schemas.job import JobListItem

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin-jobs"])

_DEFAULT_LIMIT = 200
_MAX_LIMIT = 500

# (org_id, org_name, schema_name)
type _OrgRef = tuple[object, str, str]


async def _collect_org_active_jobs(
    org: _OrgRef, *, now: datetime, stuck_cutoff: datetime
) -> list[AdminJobItem]:
    """Fetch a single org's non-terminal jobs, annotated for the admin feed.

    Resilient per-org (mirrors the reconcile sweep): a schema that fails to
    query — e.g. mid-provisioning — is logged and contributes nothing rather
    than failing the whole request.
    """
    org_id, org_name, schema = org
    session_maker = get_session_maker()
    try:
        async with session_maker() as session, session.begin():
            # SET LOCAL only survives inside a transaction — the `session.begin()`
            # block is required for the search_path to hold across the SELECT.
            await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
            rows = list(
                (
                    await session.execute(
                        select(Job)
                        .where(Job.status.in_(_STUCK_JOB_STATES))
                        .options(defer(Job.payload), defer(Job.result))
                        .order_by(Job.created_at.asc())
                    )
                )
                .scalars()
                .all()
            )
    except Exception:
        logger.exception("admin active-job feed failed for org %s", org_id)
        return []

    items: list[AdminJobItem] = []
    for job in rows:
        base = JobListItem.model_validate(job).model_dump()
        items.append(
            AdminJobItem(
                **base,
                org_id=org_id,
                org_name=org_name,
                is_stuck=job.created_at < stuck_cutoff,
                age_seconds=int((now - job.created_at).total_seconds()),
            )
        )
    return items


@router.get("/jobs/active", response_model=AdminActiveJobs)
async def list_active_jobs(
    limit: int = Query(default=_DEFAULT_LIMIT, ge=1, le=_MAX_LIMIT),
    _user: User = Depends(require_superuser),
    settings: Settings = Depends(get_settings),
) -> AdminActiveJobs:
    """Live ongoing + stuck jobs across all active orgs."""
    now = datetime.now(UTC)
    stuck_cutoff = now - timedelta(minutes=settings.job_stuck_timeout_minutes)

    session_maker = get_session_maker()
    async with session_maker() as session:
        result = await session.execute(
            select(
                Organization.id, Organization.name, Organization.schema_name
            ).where(
                Organization.status == OrganizationStatus.active,
                Organization.deleted_at.is_(None),
            )
        )
        orgs: list[_OrgRef] = [
            (row.id, row.name, row.schema_name) for row in result.all()
        ]

    async def _one(org: _OrgRef) -> list[AdminJobItem]:
        return await _collect_org_active_jobs(org, now=now, stuck_cutoff=stuck_cutoff)

    per_org = await map_bounded(orgs, _one, limit=settings.sweep_org_concurrency)
    all_items = [item for sub in per_org for item in sub]
    # Oldest first — the jobs most at risk of being stuck surface at the top.
    all_items.sort(key=lambda it: it.created_at)

    total_active = len(all_items)
    total_stuck = sum(1 for it in all_items if it.is_stuck)
    return AdminActiveJobs(
        summary=AdminActiveJobsSummary(active=total_active, stuck=total_stuck),
        items=all_items[:limit],
        truncated=total_active > limit,
        generated_at=now,
    )


@router.get("/processor/queue-stats", response_model=ProcessorQueueStats)
async def processor_queue_stats(
    _user: User = Depends(require_superuser),
    settings: Settings = Depends(get_settings),
) -> ProcessorQueueStats:
    """Live BullMQ queue depth, proxied from the processor worker."""
    try:
        data = await fetch_queue_stats(settings)
    except DispatchJobError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="PROCESSOR_UNREACHABLE"
        ) from exc
    return ProcessorQueueStats.model_validate(data)


__all__ = ["router"]
