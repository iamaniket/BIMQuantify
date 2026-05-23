"""Lightweight action dispatch to the processor worker.

Unlike ``dispatch_job`` this does NOT require a ``Job`` DB row — it
generates a random correlation UUID and POSTs directly. Designed for
fire-and-forget actions (email delivery, external API calls) where
the caller handles idempotency at the domain level.

Tests swap in a recording stub via ``set_action_dispatcher``.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from uuid import UUID, uuid4

from bimstitch_api.config import Settings
from bimstitch_api.jobs.dispatcher import DispatchJobError, _get_http_client

logger = logging.getLogger(__name__)

ActionDispatcher = Callable[[str, dict, Settings, UUID], Awaitable[None]]

_RETRY_DELAYS = (0.5, 1.0, 2.0)


async def _http_dispatch(
    action_type: str,
    payload: dict,
    settings: Settings,
    organization_id: UUID,
) -> None:
    import httpx

    body = {
        "job_id": str(uuid4()),
        "job_type": action_type,
        "organization_id": str(organization_id),
        "payload": payload,
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
                    "Processor returned %d on action dispatch attempt %d, retrying",
                    response.status_code,
                    attempt + 1,
                )
                await asyncio.sleep(_RETRY_DELAYS[attempt])
                continue
            if response.status_code >= 400:
                raise DispatchJobError(
                    f"processor worker returned {response.status_code}: "
                    f"{response.text[:200]}"
                )
            return
        except DispatchJobError:
            raise
        except Exception as exc:
            last_err = exc
            if attempt < len(_RETRY_DELAYS):
                logger.warning(
                    "Processor unreachable on action dispatch attempt %d (%s), retrying",
                    attempt + 1,
                    type(exc).__name__,
                )
                await asyncio.sleep(_RETRY_DELAYS[attempt])
            else:
                raise DispatchJobError(f"{type(exc).__name__}: {exc}") from exc

    if last_err is not None:
        raise DispatchJobError(f"{type(last_err).__name__}: {last_err}") from last_err


_dispatcher: ActionDispatcher = _http_dispatch


def set_action_dispatcher(dispatcher: ActionDispatcher) -> None:
    global _dispatcher
    _dispatcher = dispatcher


def reset_action_dispatcher() -> None:
    global _dispatcher
    _dispatcher = _http_dispatch


async def dispatch_action(
    action_type: str,
    payload: dict,
    settings: Settings,
    organization_id: UUID,
) -> None:
    """Dispatch a lightweight action to the processor worker."""
    await _dispatcher(action_type, payload, settings, organization_id)
