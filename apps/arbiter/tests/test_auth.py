"""Tests for the shared-secret bearer gate on the MCP transport."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest
from starlette.testclient import TestClient

from arbiter.auth import BearerAuthMiddleware

if TYPE_CHECKING:
    from collections.abc import Iterator

SECRET = "test-secret"


async def _ok_app(scope: dict[str, Any], receive: Any, send: Any) -> None:
    """Minimal ASGI app: 200 on http, full lifespan handshake otherwise.

    Handling lifespan here lets the TestClient context manager exercise the
    middleware's non-http pass-through (a lifespan that never completes would
    hang the context manager).
    """
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    else:
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": b'{"ok":true}'})


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = BearerAuthMiddleware(_ok_app, SECRET)
    with TestClient(app) as c:  # context manager runs the lifespan protocol
        yield c


def test_missing_header_is_401(client: TestClient) -> None:
    resp = client.post("/mcp")
    assert resp.status_code == 401
    assert resp.json() == {"error": "UNAUTHORIZED"}


def test_wrong_secret_is_401(client: TestClient) -> None:
    resp = client.post("/mcp", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401


def test_malformed_header_without_bearer_is_401(client: TestClient) -> None:
    resp = client.post("/mcp", headers={"Authorization": SECRET})
    assert resp.status_code == 401


def test_correct_secret_passes_through(client: TestClient) -> None:
    resp = client.post("/mcp", headers={"Authorization": f"Bearer {SECRET}"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
