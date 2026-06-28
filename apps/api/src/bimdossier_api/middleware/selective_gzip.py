"""Path-aware GZip wrapper (BREACH mitigation, finding L7).

Starlette's ``GZipMiddleware`` compresses every response over ``minimum_size``.
That is fine for bulk JSON, but it is the precondition for a BREACH-class attack
on responses that mix a **secret** with **attacker-influenced reflected input**:
the auth endpoints return tokens (``/auth/jwt/login``, ``/auth/jwt/refresh``) and
reflect caller-supplied input in their error envelopes (the login email, 422
validation field names/values). Compressing secret + guess together turns the
compressed length into a size oracle the attacker can probe over many requests.

This middleware wraps ``GZipMiddleware`` and simply bypasses it for a small set
of exempt path prefixes (``/auth/`` by default), so those responses are always
sent uncompressed. Auth payloads are tiny and not in a hot loop, so the lost
compression is immaterial. Every other route keeps compression unchanged.

Registered in place of the bare ``GZipMiddleware`` in ``create_app`` — it takes
the same ``minimum_size`` / ``compresslevel`` kwargs and occupies the same slot
in the middleware stack, so ordering is unchanged.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from starlette.middleware.gzip import GZipMiddleware

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Receive, Scope, Send

# Paths whose responses must never be gzipped. ``str.startswith`` accepts a tuple,
# so this is matched as a prefix set against ``scope["path"]``.
GZIP_EXEMPT_PREFIXES: tuple[str, ...] = ("/auth/",)


class SelectiveGZipMiddleware:
    """GZip everything except responses on the exempt path prefixes."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        minimum_size: int = 500,
        compresslevel: int = 5,
        exempt_prefixes: tuple[str, ...] = GZIP_EXEMPT_PREFIXES,
    ) -> None:
        self.app = app
        self.exempt_prefixes = exempt_prefixes
        # The wrapped GZip app compresses; bypassing it (calling self.app
        # directly) leaves the response uncompressed.
        self._gzip = GZipMiddleware(
            app, minimum_size=minimum_size, compresslevel=compresslevel
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and not scope["path"].startswith(self.exempt_prefixes):
            await self._gzip(scope, receive, send)
        else:
            await self.app(scope, receive, send)
