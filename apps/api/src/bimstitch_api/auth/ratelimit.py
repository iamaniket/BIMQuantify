"""Per-user rate limiting for expensive authenticated endpoints.

The auth/access-request limiters in `auth/routes.py` key on client IP (the
fastapi-limiter default), which is too coarse for a multi-tenant SaaS — users
behind a shared NAT/proxy would share a budget. These limiters key on the
authenticated user instead, falling back to IP for unauthenticated callers.

The user id comes from `request.state.decoded_token`, which `_impersonator_middleware`
(`main.py`) stashes for every request carrying a valid access token, before route
dependencies run.

Each limiter is built with an explicit endpoint `label` rather than the request
path: the rate-limited paths embed resource UUIDs, so keying on the concrete path
would hand every file/report its own budget instead of one budget per user per
action.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi_limiter.depends import RateLimiter

from bimstitch_api.config import get_settings

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from fastapi import Request


def _who(request: Request) -> str:
    """Identify the caller: authenticated user id when present, else client IP."""
    decoded = getattr(request.state, "decoded_token", None)
    if decoded is not None:
        return f"user:{decoded.user_id}"
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        ip = forwarded.split(",", 1)[0].strip()
    elif request.client is not None:
        ip = request.client.host
    else:
        ip = "unknown"
    return f"ip:{ip}"


def make_identifier(label: str) -> Callable[[Request], Awaitable[str]]:
    """Build a per-user (fallback per-IP) rate-limit identifier scoped to a
    stable endpoint `label` (not the concrete, UUID-bearing request path)."""

    async def identifier(request: Request) -> str:
        return f"{_who(request)}:{label}"

    return identifier


_settings = get_settings()

COMPLIANCE_CHECK_LIMITER = RateLimiter(
    times=_settings.rate_limit_compliance_per_hour,
    seconds=3600,
    identifier=make_identifier("compliance_check"),
)
REPORT_GEN_LIMITER = RateLimiter(
    times=_settings.rate_limit_report_per_hour,
    seconds=3600,
    identifier=make_identifier("report_create"),
)
UPLOAD_INITIATE_LIMITER = RateLimiter(
    times=_settings.rate_limit_upload_initiate_per_hour,
    seconds=3600,
    identifier=make_identifier("upload_initiate"),
)
