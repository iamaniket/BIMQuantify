"""Shared-secret bearer auth for the Arbiter MCP transport.

The MCP server reads any artifact in the shared IFC bucket and rewrites the rule
YAML that feeds every tenant's compliance verdicts, so an unauthenticated,
host-reachable transport is a cross-tenant breach one network hop away. This
mirrors the processor's ``isAuthorized`` check (apps/processor/src/http/routes.ts)
and the API's ``require_worker_secret`` (apps/api/.../jobs/dispatcher.py): a
constant-time ``Bearer <secret>`` comparison that rejects every request lacking
the shared secret before any tool runs.

Implemented as a *pure ASGI* middleware (not Starlette's ``BaseHTTPMiddleware``,
which buffers responses and breaks streaming) so it composes with the
StreamableHTTP session manager: non-``http`` scopes (``lifespan``, ``websocket``)
are forwarded untouched, so the wrapped app's lifespan still runs.
"""

from __future__ import annotations

import hmac

from starlette.types import ASGIApp, Receive, Scope, Send


class BearerAuthMiddleware:
    """Reject any HTTP request without a valid ``Authorization: Bearer`` header."""

    def __init__(self, app: ASGIApp, secret: str) -> None:
        self._app = app
        # Pre-encode the expected header once; compare in constant time below.
        self._expected = b"Bearer " + secret.encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            # lifespan / websocket — pass through so the session-manager lifespan runs.
            await self._app(scope, receive, send)
            return

        if not self._authorized(scope):
            await self._reject(send)
            return

        await self._app(scope, receive, send)

    def _authorized(self, scope: Scope) -> bool:
        header: bytes | None = None
        for name, value in scope.get("headers", []):
            if name == b"authorization":
                header = value
                break
        if header is None:
            return False
        # hmac.compare_digest is constant-time and safe on unequal lengths.
        return hmac.compare_digest(header, self._expected)

    @staticmethod
    async def _reject(send: Send) -> None:
        body = b'{"error":"UNAUTHORIZED"}'
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
