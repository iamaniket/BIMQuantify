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
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.background.locks import lock_id_for
from bimdossier_api.config import Settings, get_settings
from bimdossier_api.models.job import Job, JobStatus

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Outbound dispatch
# ---------------------------------------------------------------------------


class DispatchJobError(Exception):
    """Raised when the API cannot reach (or post to) the processor worker."""


JobDispatcher = Callable[[Job, Settings, UUID], Awaitable[None]]


_RETRY_DELAYS = (0.5, 1.0, 2.0)

_http_client: httpx.AsyncClient | None = None


def _get_http_client(timeout: httpx.Timeout) -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=timeout,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _http_client


async def close_http_client() -> None:
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


async def _http_dispatch(job: Job, settings: Settings, organization_id: UUID) -> None:
    body = {
        "job_id": str(job.id),
        "job_type": job.job_type.value,
        "organization_id": str(organization_id),
        "payload": dict(job.payload or {}),
        # Tell the worker which API instance to call back to (L13) rather than
        # relying on its single baked API_BASE_URL.
        "callback_url": settings.api_base_url.rstrip("/"),
    }
    headers = {"Authorization": f"Bearer {settings.processor_shared_secret}"}
    timeout = httpx.Timeout(settings.processor_dispatch_timeout_seconds)
    client = _get_http_client(timeout)

    last_err: Exception | None = None
    for attempt in range(len(_RETRY_DELAYS) + 1):
        try:
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


# ---------------------------------------------------------------------------
# Outbound cancel
# ---------------------------------------------------------------------------

# The processor reports one of these after we ask it to drop a queued job.
CancelResult = str  # "removed" | "not_found" | "already_running"

JobCanceller = Callable[[UUID, Settings], Awaitable[CancelResult]]


async def _http_cancel(job_id: UUID, settings: Settings) -> CancelResult:
    """Ask the processor to remove a still-queued BullMQ job.

    Returns "removed"/"not_found" (both mean the worker won't run it) or
    "already_running" (409 — the job started before we could cancel; the
    caller must NOT mark it cancelled). Raises DispatchJobError if the
    processor is unreachable, so we never mark a job cancelled while it may
    still be running.
    """
    headers = {"Authorization": f"Bearer {settings.processor_shared_secret}"}
    timeout = httpx.Timeout(settings.processor_dispatch_timeout_seconds)
    client = _get_http_client(timeout)
    try:
        response = await client.post(
            f"{settings.processor_url.rstrip('/')}/jobs/{job_id}/cancel",
            headers=headers,
        )
    except httpx.HTTPError as exc:
        raise DispatchJobError(f"{type(exc).__name__}: {exc}") from exc
    if response.status_code == 409:
        return "already_running"
    if response.status_code >= 400:
        raise DispatchJobError(
            f"processor worker returned {response.status_code}: {response.text[:200]}"
        )
    body = response.json() if response.content else {}
    result = body.get("result", "removed")
    return str(result)


_canceller: JobCanceller = _http_cancel


def set_job_canceller(canceller: JobCanceller) -> None:
    """Test hook: replace the default HTTP canceller with a recording stub."""
    global _canceller
    _canceller = canceller


def reset_job_canceller() -> None:
    global _canceller
    _canceller = _http_cancel


def get_job_canceller() -> JobCanceller:
    return _canceller


async def cancel_dispatched_job(job_id: UUID, settings: Settings) -> CancelResult:
    """Ask the processor to cancel a queued job. Raises DispatchJobError if unreachable."""
    return await _canceller(job_id, settings)


# ---------------------------------------------------------------------------
# Processor introspection (admin dashboard)
# ---------------------------------------------------------------------------

# Live BullMQ queue depth, keyed by queue name → {status: count}. Returned
# verbatim from the processor's `/admin/queue-stats`.
QueueStats = dict[str, dict[str, int]]

QueueStatsFetcher = Callable[[Settings], Awaitable[QueueStats]]


async def _http_fetch_queue_stats(settings: Settings) -> QueueStats:
    """GET the processor's live queue counts. Raises DispatchJobError if unreachable."""
    headers = {"Authorization": f"Bearer {settings.processor_shared_secret}"}
    timeout = httpx.Timeout(settings.processor_dispatch_timeout_seconds)
    client = _get_http_client(timeout)
    try:
        response = await client.get(
            f"{settings.processor_url.rstrip('/')}/admin/queue-stats",
            headers=headers,
        )
    except httpx.HTTPError as exc:
        raise DispatchJobError(f"{type(exc).__name__}: {exc}") from exc
    if response.status_code >= 400:
        raise DispatchJobError(
            f"processor worker returned {response.status_code}: {response.text[:200]}"
        )
    return response.json()  # type: ignore[no-any-return]


_queue_stats_fetcher: QueueStatsFetcher = _http_fetch_queue_stats


def set_queue_stats_fetcher(fetcher: QueueStatsFetcher) -> None:
    """Test hook: replace the default HTTP queue-stats fetcher with a stub."""
    global _queue_stats_fetcher
    _queue_stats_fetcher = fetcher


def reset_queue_stats_fetcher() -> None:
    global _queue_stats_fetcher
    _queue_stats_fetcher = _http_fetch_queue_stats


async def fetch_queue_stats(settings: Settings) -> QueueStats:
    """Fetch live processor queue depth. Raises DispatchJobError if unreachable."""
    return await _queue_stats_fetcher(settings)


class JobConcurrencyError(Exception):
    """Raised when a tenant has too many active jobs."""


_ACTIVE_STATUSES = [JobStatus.pending, JobStatus.started, JobStatus.running]


async def check_job_concurrency(session: AsyncSession, settings: Settings) -> None:
    # Serialize the count-then-insert per org (M-con2): without a lock two
    # requests both read `active == limit-1`, both pass this check, and both
    # INSERT their Job — overshooting the cap. A transaction-scoped advisory
    # lock keyed on the active org makes the check-and-insert atomic per tenant.
    # It auto-releases at commit/rollback, so it honors the "endpoints using a
    # tenant session MUST NOT call session.commit()" rule — the wrapping
    # `session.begin()` owns the transaction and the lock dies with it. The org
    # id comes from the tenant GUC the session already carries
    # (`app.current_org_id`); if it's unset (a non-tenant caller) we skip the
    # lock rather than serialize every org onto one global key.
    org_key = await session.scalar(
        text("SELECT current_setting('app.current_org_id', true)")
    )
    if org_key:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(:k)"),
            {"k": lock_id_for(f"job_concurrency:{org_key}")},
        )
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
