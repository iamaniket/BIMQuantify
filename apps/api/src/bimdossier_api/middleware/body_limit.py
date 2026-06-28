"""Global request-body-size limit (pure-ASGI middleware).

Closes the single-process-API OOM vector (B3): without this, any verified member
could POST a multi-GB body to any endpoint and exhaust the instance's memory,
taking down every concurrent request on it. Two layers of defense:

* **Fast reject** — a declared ``Content-Length`` already over the cap is
  refused before the app reads a single byte. This covers every normal client
  (browsers / httpx / requests all send ``Content-Length`` for buffered bodies)
  and the actual exploit (uploading a large file or zip).
* **Streamed counter** — for a hand-crafted client that omits / understates
  ``Content-Length`` and uses chunked transfer encoding, the wrapped ``receive``
  sums ``http.request`` body bytes and truncates the stream the moment the cap
  is crossed, so the oversized body is never buffered.

The "too large" signal is an ``http.disconnect`` returned from the wrapped
``receive`` — never a raised exception — so it can't surface as a spurious 500
from the byte-counting path itself. A correct body reader (Starlette's
``Request``) turns that disconnect into ``ClientDisconnect``, which we catch and
convert into the same localized 413. The 413 is only emitted while the response
hasn't started (tracked via a wrapped ``send``), so we never double-commit.

This middleware is added via ``add_middleware`` and therefore runs *outside*
Starlette's ``ExceptionMiddleware`` — an ``HTTPException`` raised here would NOT
reach ``http_exception_handler``. It builds the localized ``{code, message,
detail}`` envelope itself via ``build_localized_error`` so the response shape is
byte-identical to every other API error.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from starlette.requests import ClientDisconnect, Request

from bimdossier_api.i18n.http_errors import build_localized_error

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send

_CODE = "REQUEST_BODY_TOO_LARGE"
_STATUS = 413


async def _noop_receive() -> Message:
    """Receive callable for the 413 response (which never reads the body)."""
    return {"type": "http.disconnect"}


def _parse_content_length(raw: str | None) -> int | None:
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


class RequestBodySizeLimitMiddleware:
    """Reject HTTP requests whose body exceeds ``max_bytes`` with a 413."""

    def __init__(self, app: ASGIApp, *, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = _parse_content_length(Request(scope).headers.get("content-length"))
        if declared is not None and declared > self.max_bytes:
            await self._reject(scope, send)
            return

        body_seen = 0
        too_large = False
        response_started = False

        async def wrapped_receive() -> Message:
            nonlocal body_seen, too_large
            message = await receive()
            if message["type"] == "http.request":
                body_seen += len(message.get("body", b""))
                if body_seen > self.max_bytes:
                    too_large = True
                    # Truncate the stream so the app stops reading and never
                    # buffers the oversized body. We emit the 413 below.
                    return {"type": "http.disconnect"}
            return message

        async def wrapped_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, wrapped_receive, wrapped_send)
        except ClientDisconnect:
            # The body reader hit our injected disconnect (or the client really
            # went away). Only the former warrants a 413; the latter leaves
            # too_large False and we stay silent.
            if not (too_large and not response_started):
                raise
        if too_large and not response_started:
            await self._reject(scope, send)

    async def _reject(self, scope: Scope, send: Send) -> None:
        response = build_localized_error(
            Request(scope),
            _STATUS,
            _CODE,
            {"code": _CODE, "max_bytes": self.max_bytes},
        )
        await response(scope, _noop_receive, send)
