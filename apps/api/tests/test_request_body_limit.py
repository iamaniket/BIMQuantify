"""Tests for the global request-body-size limit middleware (B3).

Self-contained: drives ``RequestBodySizeLimitMiddleware`` directly (unit) and
over a minimal Starlette app via httpx (integration). No DB/Redis logic of its
own — the conftest truncation/seed fixtures all skip because no DB fixtures are
requested.
"""

from __future__ import annotations

import contextlib
import json

from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from bimdossier_api.middleware.body_limit import RequestBodySizeLimitMiddleware

# ---------------------------------------------------------------------------
# Integration — real Starlette app + middleware over httpx ASGITransport
# ---------------------------------------------------------------------------


def _build_app(max_bytes: int) -> Starlette:
    async def echo(request: Request) -> PlainTextResponse:
        body = await request.body()
        return PlainTextResponse(f"read {len(body)}")

    app = Starlette(routes=[Route("/echo", echo, methods=["POST"])])
    app.add_middleware(RequestBodySizeLimitMiddleware, max_bytes=max_bytes)
    return app


async def _post(app: Starlette, **kwargs: object) -> object:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.post("/echo", **kwargs)  # type: ignore[arg-type]


async def test_under_limit_passes() -> None:
    resp = await _post(_build_app(1024), content=b"x" * 100)
    assert resp.status_code == 200
    assert resp.text == "read 100"


async def test_body_exactly_at_limit_passes() -> None:
    resp = await _post(_build_app(50), content=b"x" * 50)
    assert resp.status_code == 200
    assert resp.text == "read 50"


async def test_content_length_over_limit_fast_rejects() -> None:
    resp = await _post(
        _build_app(10),
        content=b"x" * 100,
        headers={"accept-language": "en"},
    )
    assert resp.status_code == 413
    body = resp.json()
    assert body["code"] == "REQUEST_BODY_TOO_LARGE"
    assert body["detail"] == {"code": "REQUEST_BODY_TOO_LARGE", "max_bytes": 10}
    assert body["message"]  # localized, non-empty


# ---------------------------------------------------------------------------
# Unit — drive the middleware class directly with hand-built ASGI primitives
# ---------------------------------------------------------------------------


def _http_scope(headers: list[tuple[bytes, bytes]] | None = None) -> dict[str, object]:
    return {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "path": "/echo",
        "raw_path": b"/echo",
        "query_string": b"",
        "headers": headers or [],
        "scheme": "http",
        "client": ("127.0.0.1", 12345),
        "server": ("test", 80),
    }


def _receive_from(messages: list[dict[str, object]]):
    queue = list(messages)

    async def receive() -> dict[str, object]:
        if queue:
            return queue.pop(0)
        return {"type": "http.disconnect"}

    return receive


class _Send:
    def __init__(self) -> None:
        self.messages: list[dict[str, object]] = []

    async def __call__(self, message: dict[str, object]) -> None:
        self.messages.append(message)


def _starts(send: _Send) -> list[dict[str, object]]:
    return [m for m in send.messages if m["type"] == "http.response.start"]


def _body(send: _Send) -> bytes:
    return b"".join(
        m.get("body", b"")  # type: ignore[misc]
        for m in send.messages
        if m["type"] == "http.response.body"
    )


async def _body_reader_app(scope, receive, send) -> None:
    """Downstream app that reads the body via Request → raises ClientDisconnect
    on our injected truncation, exactly as a real route would."""
    body = await Request(scope, receive).body()
    response = PlainTextResponse(f"read {len(body)}")
    await response(scope, receive, send)


_OVERFLOW_CHUNKS = [
    {"type": "http.request", "body": b"x" * 8, "more_body": True},
    {"type": "http.request", "body": b"x" * 8, "more_body": True},
    {"type": "http.request", "body": b"x" * 8, "more_body": False},
]


async def test_non_http_scope_passes_through() -> None:
    seen: dict[str, object] = {}

    async def app(scope, receive, send) -> None:
        seen["type"] = scope["type"]

    async def receive() -> dict[str, object]:
        return {"type": "lifespan.startup"}

    async def send(message: dict[str, object]) -> None:
        pass

    mw = RequestBodySizeLimitMiddleware(app, max_bytes=10)
    await mw({"type": "lifespan"}, receive, send)
    assert seen["type"] == "lifespan"


async def test_streamed_overflow_without_content_length_rejects() -> None:
    send = _Send()
    mw = RequestBodySizeLimitMiddleware(_body_reader_app, max_bytes=10)
    await mw(_http_scope(), _receive_from(_OVERFLOW_CHUNKS), send)

    starts = _starts(send)
    assert len(starts) == 1
    assert starts[0]["status"] == 413
    assert json.loads(_body(send))["code"] == "REQUEST_BODY_TOO_LARGE"


async def test_no_413_when_response_already_started() -> None:
    async def streaming_app(scope, receive, send) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        with contextlib.suppress(Exception):  # app already committed its status line
            await Request(scope, receive).body()
        await send({"type": "http.response.body", "body": b"partial"})

    send = _Send()
    mw = RequestBodySizeLimitMiddleware(streaming_app, max_bytes=10)
    await mw(_http_scope(), _receive_from(_OVERFLOW_CHUNKS), send)

    starts = _starts(send)
    assert len(starts) == 1
    assert starts[0]["status"] == 200  # the app's response, never a second 413


async def test_genuine_client_disconnect_is_not_a_413() -> None:
    """A real disconnect (not our truncation) must propagate, not become a 413."""
    send = _Send()
    mw = RequestBodySizeLimitMiddleware(_body_reader_app, max_bytes=1000)
    # First message is a real disconnect; body stays under the cap.
    raised = False
    try:
        await mw(_http_scope(), _receive_from([{"type": "http.disconnect"}]), send)
    except Exception:
        raised = True
    assert raised
    assert not _starts(send)  # no spurious 413 emitted
