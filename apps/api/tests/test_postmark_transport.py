from __future__ import annotations

import json

import httpx
import pytest

from bimdossier_api.config import get_settings
from bimdossier_api.email.transport import PostmarkEmailTransport


# Override conftest's DB/Redis autouse fixtures — this is a pure-unit test
# of an HTTP transport, not an end-to-end app test.
@pytest.fixture(autouse=True)
def _clean_tables() -> None:
    return None


@pytest.fixture(autouse=True)
def _flush_redis() -> None:
    return None


@pytest.fixture(autouse=True)
def _stub_extraction_dispatcher() -> None:
    return None


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    get_settings.cache_clear()


async def test_postmark_transport_posts_expected_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POSTMARK_SERVER_TOKEN", "test-token")
    monkeypatch.setenv("POSTMARK_MESSAGE_STREAM", "broadcast")
    monkeypatch.setenv("SMTP_FROM", "alerts@bimdossier.example.com")

    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = request.content.decode()
        return httpx.Response(200, json={"MessageID": "abc-123"})

    transport = PostmarkEmailTransport()
    mock = httpx.MockTransport(handler)
    real_client_cls = httpx.AsyncClient

    def _client_factory(*args: object, **kwargs: object) -> httpx.AsyncClient:
        kwargs["transport"] = mock
        return real_client_cls(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(httpx, "AsyncClient", _client_factory)

    await transport.send("dest@example.com", "Subject", "Body")

    assert captured["url"] == PostmarkEmailTransport.POSTMARK_URL
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["x-postmark-server-token"] == "test-token"
    body = captured["body"]
    assert isinstance(body, str)
    parsed = json.loads(body)
    assert parsed == {
        "From": "alerts@bimdossier.example.com",
        "To": "dest@example.com",
        "Subject": "Subject",
        "TextBody": "Body",
        "MessageStream": "broadcast",
    }


async def test_postmark_transport_raises_when_token_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("POSTMARK_SERVER_TOKEN", raising=False)
    transport = PostmarkEmailTransport()
    with pytest.raises(RuntimeError, match="POSTMARK_SERVER_TOKEN"):
        await transport.send("x@example.com", "s", "b")
