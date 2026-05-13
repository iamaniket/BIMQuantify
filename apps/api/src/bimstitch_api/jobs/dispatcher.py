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

import hmac
import logging
from collections.abc import Awaitable, Callable
from typing import Annotated

import httpx
from fastapi import Depends, Header, HTTPException, status

from bimstitch_api.config import Settings, get_settings
from bimstitch_api.models.job import Job

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Outbound dispatch
# ---------------------------------------------------------------------------


class DispatchJobError(Exception):
    """Raised when the API cannot reach (or post to) the processor worker."""


JobDispatcher = Callable[[Job, Settings], Awaitable[None]]


async def _http_dispatch(job: Job, settings: Settings) -> None:
    body = {
        "job_id": str(job.id),
        "job_type": job.job_type.value,
        "payload": dict(job.payload or {}),
    }
    headers = {"Authorization": f"Bearer {settings.processor_shared_secret}"}
    timeout = httpx.Timeout(settings.processor_dispatch_timeout_seconds)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{settings.processor_url.rstrip('/')}/jobs",
                json=body,
                headers=headers,
            )
        if response.status_code >= 400:
            raise DispatchJobError(
                f"processor worker returned {response.status_code}: {response.text[:200]}"
            )
    except httpx.HTTPError as exc:
        raise DispatchJobError(f"{type(exc).__name__}: {exc}") from exc


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


async def dispatch_job(job: Job, settings: Settings) -> None:
    """Hand a Job off to the processor worker. Raises DispatchJobError on failure.

    The Job's `payload` JSONB is the contract with the worker; the worker
    dispatches on `job.job_type` and validates `payload` per type.
    """
    await _dispatcher(job, settings)


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
