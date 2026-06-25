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

from bimdossier_api.config import get_settings

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from fastapi import Request


def _client_ip(request: Request) -> str:
    """The caller's source IP for rate-limit bucketing.

    Defaults to the immediate peer (`request.client.host`). `X-Forwarded-For`
    is honored ONLY when the immediate peer is a configured trusted proxy
    (`TRUSTED_PROXY_IPS`), in which case the right-most hop — the address the
    trusted proxy actually observed — is used. A direct attacker is not a
    trusted proxy, so a spoofed XFF header is ignored and cannot be used to
    mint a fresh rate-limit bucket per request.
    """
    peer = request.client.host if request.client is not None else "unknown"
    trusted = get_settings().trusted_proxy_ip_set
    if trusted and peer in trusted:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
            if hops:
                return hops[-1]
    return peer


def _who(request: Request) -> str:
    """Identify the caller: authenticated user id when present, else client IP."""
    decoded = getattr(request.state, "decoded_token", None)
    if decoded is not None:
        return f"user:{decoded.user_id}"
    return f"ip:{_client_ip(request)}"


async def default_rate_limit_identifier(request: Request) -> str:
    """Trusted-proxy-aware default identifier for `FastAPILimiter.init`.

    fastapi-limiter's built-in default keys on the raw, client-supplied
    `X-Forwarded-For` header, so an attacker rotates it to get a fresh bucket
    per request — defeating the login / forgot-password / refresh throttles.
    This keys on the real peer IP (honoring XFF only behind a trusted proxy)
    plus the request path, preserving the library's per-path bucketing for the
    auth limiters that rely on the default identifier.
    """
    path = request.scope.get("path", "")
    return f"{_client_ip(request)}:{path}"


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
