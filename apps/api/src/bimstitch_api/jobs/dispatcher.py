"""Outbound job dispatch + inbound shared-secret guard.

The API hands every async job (IFC extraction, PDF extraction, PDF report
generation, …) off to the `apps/processor` Node worker. This module is the
sole HTTP seam. The worker dispatches by `job_type`; everything type-specific
goes inside the opaque `payload` JSONB.

* `dispatch_job(job, settings)` — outbound POST to `{PROCESSOR_URL}/jobs`.
* `require_worker_secret` — inbound bearer-token guard for `/internal/jobs/*`.

Tests swap in a recording stub via `set_job_dispatcher`.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
from collections.abc import Awaitable, Callable
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.config import Settings, get_settings
from bimstitch_api.models.job import Job, JobStatus

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Outbound dispatch
# ---------------------------------------------------------------------------


class DispatchJobError(Exception):
    """Raised when the API cannot reach (or post to) the processor worker."""


JobDispatcher = Callable[[Job, Settings, UUID], Awaitable[None]]


_RETRY_DELAYS = (0.5, 1.0, 2.0)


async def _http_dispatch(job: Job, settings: Settings, organization_id: UUID) -> None:
    body = {
        "job_id": str(job.id),
        "job_type": job.job_type.value,
        "organization_id": str(organization_id),
        "payload": dict(job.payload or {}),
    }
    headers = {"Authorization": f"Bearer {settings.processor_shared_secret}"}
    timeout = httpx.Timeout(settings.processor_dispatch_timeout_seconds)

    last_err: Exception | None = None
    for attempt in range(len(_RETRY_DELAYS) + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    f"{settings.processor_url.rstrip('/')}/jobs",
                    json=body,
                    headers=headers,
                )
            if response.status_code >= 500 and attempt < len(_RETRY_DELAYS):
                logger.warning(
                    "Processor returned %d on attempt %d, retrying",
                    response.status_code,
                    attempt + 1,
                )
                await asyncio.sleep(_RETRY_DELAYS[attempt])
                continue
            if response.status_code >= 400:
                raise DispatchJobError(
                    f"processor worker returned {response.status_code}: {response.text[:200]}"
                )
            return
        except httpx.HTTPError as exc:
            last_err = exc
            if attempt < len(_RETRY_DELAYS):
                logger.warning(
                    "Processor unreachable on attempt %d (%s), retrying",
                    attempt + 1,
                    type(exc).__name__,
                )
                await asyncio.sleep(_RETRY_DELAYS[attempt])
            else:
                raise DispatchJobError(f"{type(exc).__name__}: {exc}") from exc

    if last_err is not None:
        raise DispatchJobError(f"{type(last_err).__name__}: {last_err}") from last_err


_dispatcher: JobDispatcher = _http_dispatch


def set_job_dispatcher(dispatcher: JobDispatcher) -> None:
    """Test hook: replace the default HTTP dispatcher (e.g. with a recording stub)."""
    global _dispatcher
    _dispatcher = dispatcher


def reset_job_dispatcher() -> None:
    """Reset the dispatcher to the real HTTP implementation."""
    global _dispatcher
    _dispatcher = _http_dispatch


def get_job_dispatcher() -> JobDispatcher:
    return _dispatcher


class JobConcurrencyError(Exception):
    """Raised when a tenant has too many active jobs."""


_ACTIVE_STATUSES = [JobStatus.pending, JobStatus.started, JobStatus.running]


async def check_job_concurrency(session: AsyncSession, settings: Settings) -> None:
    active = (
        await session.scalar(
            select(func.count())
            .select_from(Job)
            .where(Job.status.in_(_ACTIVE_STATUSES))
        )
    ) or 0
    if active >= settings.max_concurrent_jobs_per_org:
        raise JobConcurrencyError(
            f"Org has {active} active jobs (limit: {settings.max_concurrent_jobs_per_org})"
        )


async def dispatch_job(
    job: Job,
    settings: Settings,
    organization_id: UUID,
) -> None:
    """Hand a Job off to the processor worker. Raises DispatchJobError on failure."""
    await _dispatcher(job, settings, organization_id)


# ---------------------------------------------------------------------------
# Inbound auth
# ---------------------------------------------------------------------------


async def require_worker_secret(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    """Constant-time bearer-token check for the worker → API callback route."""
    expected = f"Bearer {settings.processor_shared_secret}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="UNAUTHORIZED"
        )
