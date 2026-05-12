"""Public, unauthenticated endpoints for the marketing + login surfaces.

These are explicitly carved out from the rest of the app:

- `GET /public/projects-map` — anonymized, aggregated project locations
  for the pre-login NL map. RLS is bypassed (the request has no tenant
  context); we only return city / averaged lat-lng / count so no tenant
  data leaks.

- `GET /public/system-status` — live platform health for the login page
  status badge and KPI strip. Pings DB + Redis + MinIO HEAD; degrades on
  the first failure but always returns a payload so the page never errors.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.cache.client import get_redis
from bimstitch_api.db import get_async_session
from bimstitch_api.models.project import Project, ProjectLifecycleState
from bimstitch_api.schemas.public import (
    ProjectsMapPoint,
    SystemStatusResponse,
)
from bimstitch_api.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/projects-map", response_model=list[ProjectsMapPoint])
async def projects_map(
    response: Response,
    session: AsyncSession = Depends(get_async_session),
) -> list[ProjectsMapPoint]:
    """Aggregate non-removed, geo-located projects by city.

    Uses `get_async_session` (superuser, RLS-bypass) intentionally — there
    is no tenant context on this endpoint and we only return anonymized
    counts. Cached for one minute at the CDN edge.
    """
    stmt = (
        select(
            Project.city.label("city"),
            func.avg(Project.latitude).label("lat"),
            func.avg(Project.longitude).label("lng"),
            func.count(Project.id).label("count"),
        )
        .where(
            Project.lifecycle_state != ProjectLifecycleState.removed,
            Project.latitude.isnot(None),
            Project.longitude.isnot(None),
            Project.city.isnot(None),
        )
        .group_by(Project.city)
    )
    rows = (await session.execute(stmt)).all()
    response.headers["Cache-Control"] = "public, max-age=60"
    return [
        ProjectsMapPoint(
            city=row.city,
            lat=float(row.lat),
            lng=float(row.lng),
            count=int(row.count),
        )
        for row in rows
    ]


async def _check_db(session: AsyncSession) -> bool:
    try:
        await session.execute(select(1))
        return True
    except Exception:
        logger.warning("system-status DB check failed", exc_info=True)
        return False


async def _check_redis() -> bool:
    try:
        await get_redis().ping()
        return True
    except Exception:
        logger.warning("system-status Redis check failed", exc_info=True)
        return False


async def _check_storage() -> bool:
    try:
        await get_storage().ensure_bucket()
        return True
    except Exception:
        logger.warning("system-status storage check failed", exc_info=True)
        return False


@router.get("/system-status", response_model=SystemStatusResponse)
async def system_status(
    session: AsyncSession = Depends(get_async_session),
) -> SystemStatusResponse:
    checks = {
        "db": await _check_db(session),
        "redis": await _check_redis(),
        "storage": await _check_storage(),
    }
    failing = [name for name, ok in checks.items() if not ok]
    if not failing:
        status_value = "normal"
    elif len(failing) >= 2:
        status_value = "down"
    else:
        status_value = "degraded"
    return SystemStatusResponse(status=status_value, checks=checks)
