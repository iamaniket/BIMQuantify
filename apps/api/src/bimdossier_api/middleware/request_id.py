"""Request-id correlation middleware (pure-ASGI).

Closes the request-id half of M-obs1: ``audit.py`` previously only copied an
inbound ``X-Request-Id``, so when the load balancer didn't inject one
``audit_log.request_id`` was NULL and nothing tied a log line, an audit row, and
a Sentry event together. This middleware guarantees an id for every request:

* Reuse a **valid** inbound ``X-Request-Id`` (so a trace id assigned upstream by
  the proxy / another service is preserved end to end).
* Otherwise generate a fresh one.

The resolved id is published three ways for the rest of the request:
``request_id_ctx`` (read by the logging filter, ``audit.record``, and the Sentry
``before_send``), ``request.state.request_id`` (for any code holding a Request),
and the ``X-Request-Id`` **response** header (so the caller can quote it in a bug
report).

Pure-ASGI — not ``BaseHTTPMiddleware`` — on purpose: a context var set inside a
``BaseHTTPMiddleware`` does not reliably propagate to the endpoint task, whereas
a pure-ASGI middleware sets it in the same task that awaits the app, so every
log line and audit write inside the request sees the id. Registered OUTERMOST in
``create_app`` so the id is bound before any inner layer runs and the response
header lands on every response (including CORS preflight and error envelopes).

An inbound id is accepted only if it matches a conservative token shape: this
stops a forged header from injecting CRLF into the response header / a log line
and caps the length to the ``audit_log.request_id`` column (``String(64)``). A
rejected value is silently replaced with a generated id rather than 400'd — a
malformed trace header must not break the request.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING
from uuid import uuid4

from starlette.datastructures import MutableHeaders

from bimdossier_api.logging_utils import request_id_ctx

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send

_HEADER_NAME = "X-Request-Id"
_HEADER_NAME_LOWER = b"x-request-id"
# Inbound ids must be a short, header-safe token: ASCII alphanumerics plus a few
# separators, 1-64 chars. Anything else (CRLF, spaces, overlong) is rejected.
_SAFE_ID = re.compile(r"^[A-Za-z0-9._\-]{1,64}$")


def _inbound_request_id(scope: Scope) -> str | None:
    """Return a valid inbound ``X-Request-Id`` from the ASGI scope, else None."""
    for name, value in scope.get("headers", []):
        if name == _HEADER_NAME_LOWER:
            try:
                candidate = value.decode("latin-1").strip()
            except UnicodeDecodeError:
                return None
            return candidate if _SAFE_ID.match(candidate) else None
    return None


def _generate_request_id() -> str:
    return uuid4().hex


class RequestIdMiddleware:
    """Bind a correlation id to every HTTP request and echo it back."""

    def __init__(self, app: ASGIApp, *, header_name: str = _HEADER_NAME) -> None:
        self.app = app
        self.header_name = header_name

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _inbound_request_id(scope) or _generate_request_id()
        token = request_id_ctx.set(request_id)
        # Expose on request.state too (shares scope["state"] with downstream
        # layers) for any code that reads it off the Request object.
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[self.header_name] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            request_id_ctx.reset(token)
