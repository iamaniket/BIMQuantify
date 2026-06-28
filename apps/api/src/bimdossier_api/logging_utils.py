"""Small logging helpers shared across the API."""

from __future__ import annotations

import time
from contextvars import ContextVar
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import logging

# Request-scoped correlation id. ``RequestIdMiddleware`` sets this at the start
# of every HTTP request (from an inbound ``X-Request-Id`` header or a freshly
# generated one) and resets it when the request finishes. Three consumers read
# it so a single id ties them together: the logging filter (stamps every app log
# line — see ``logging_config.RequestIdFilter``), ``audit.record`` (so
# ``audit_log.request_id`` is never NULL during a request), and the Sentry
# ``before_send`` hook (tags every error event). Defaults to ``None`` outside a
# request — background sweepers and startup carry no request context.
request_id_ctx: ContextVar[str | None] = ContextVar("bimdossier_request_id", default=None)


def get_request_id() -> str | None:
    """Return the current request's correlation id, or ``None`` outside a request."""
    return request_id_ctx.get()


# Per-key timestamp (monotonic seconds) of the last emitted WARNING. A sustained
# Redis outage would otherwise log one WARNING per request across the whole
# authenticated surface (login, refresh, every authed call) — a flood. Keying
# by call-site collapses that to one WARNING per `interval`.
_last_warned: dict[str, float] = {}


def warn_throttled(
    logger: logging.Logger,
    key: str,
    message: str,
    *,
    interval: float = 30.0,
) -> None:
    """Log ``message`` at WARNING at most once per ``interval`` seconds per ``key``.

    Suppressed repeats drop to DEBUG, so the per-request detail is still
    available when debug logging is enabled while a steady-state outage emits
    just one WARNING line every ``interval`` seconds.
    """
    now = time.monotonic()
    last = _last_warned.get(key)
    if last is None or now - last >= interval:
        _last_warned[key] = now
        logger.warning(message)
    else:
        logger.debug(message)
