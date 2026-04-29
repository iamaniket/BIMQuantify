"""Extractor integration helpers.

The API hands off heavy IFC processing to a separate Node.js extractor service
(`apps/extractor`). Two seams exist:

* `dispatch_extraction` — outbound HTTP POST after `complete_upload` succeeds.
* `require_extractor_secret` — inbound shared-secret guard for callback routes.

Network calls go through `httpx`. The transport is overridable in tests via
`set_extraction_dispatcher` so we don't need a real HTTP socket in the suite.
"""

from __future__ import annotations

import hmac
import logging
from collections.abc import Awaitable, Callable
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import Depends, Header, HTTPException, status

from bimstitch_api.config import Settings, get_settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Outbound dispatch
# ---------------------------------------------------------------------------


class ExtractionDispatchError(Exception):
    """Raised when the API cannot reach (or post to) the extractor."""


# A callable shape so tests can swap in a stub. Signature mirrors the body
# we send to POST {extractor_url}/jobs.
ExtractionDispatcher = Callable[[UUID, UUID, str, Settings], Awaitable[None]]


async def _http_dispatch(
    file_id: UUID, project_id: UUID, storage_key: str, settings: Settings
) -> None:
    payload = {
        "file_id": str(file_id),
        "project_id": str(project_id),
        "storage_key": storage_key,
    }
    headers = {"Authorization": f"Bearer {settings.extractor_shared_secret}"}
    timeout = httpx.Timeout(settings.extractor_dispatch_timeout_seconds)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{settings.extractor_url.rstrip('/')}/jobs",
                json=payload,
                headers=headers,
            )
        if response.status_code >= 400:
            raise ExtractionDispatchError(
                f"extractor returned {response.status_code}: {response.text[:200]}"
            )
    except httpx.HTTPError as exc:
        raise ExtractionDispatchError(f"{type(exc).__name__}: {exc}") from exc


_dispatcher: ExtractionDispatcher = _http_dispatch


def set_extraction_dispatcher(dispatcher: ExtractionDispatcher) -> None:
    """Test hook: replace the default HTTP dispatcher (e.g. with a stub)."""
    global _dispatcher
    _dispatcher = dispatcher


def reset_extraction_dispatcher() -> None:
    """Reset the dispatcher to the real HTTP implementation."""
    global _dispatcher
    _dispatcher = _http_dispatch


async def dispatch_extraction(
    file_id: UUID, project_id: UUID, storage_key: str, settings: Settings
) -> None:
    """Hand a file off to the extractor. Raises ExtractionDispatchError on failure."""
    await _dispatcher(file_id, project_id, storage_key, settings)


# ---------------------------------------------------------------------------
# Inbound auth
# ---------------------------------------------------------------------------


async def require_extractor_secret(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    """Constant-time bearer-token check for the extractor → API callback route."""
    expected = f"Bearer {settings.extractor_shared_secret}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="UNAUTHORIZED"
        )


__all__ = [
    "ExtractionDispatchError",
    "ExtractionDispatcher",
    "dispatch_extraction",
    "require_extractor_secret",
    "reset_extraction_dispatcher",
    "set_extraction_dispatcher",
]
