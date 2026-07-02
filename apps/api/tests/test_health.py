import json

import pytest
from httpx import AsyncClient

from bimdossier_api.routers import health as health_mod


async def test_health_returns_ok(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "timestamp" in body


class _SpyStorage:
    def __init__(self) -> None:
        self.check_called = False
        self.ensure_called = False

    async def check_bucket(self, bucket: str | None = None) -> None:
        self.check_called = True

    async def ensure_bucket(self, bucket: str | None = None) -> None:
        self.ensure_called = True


class _FakeSession:
    async def __aenter__(self) -> "_FakeSession":
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def execute(self, *args: object, **kwargs: object) -> None:
        return None


class _FakeRedis:
    async def ping(self) -> bool:
        return True


async def test_readiness_uses_read_only_bucket_check(monkeypatch: pytest.MonkeyPatch) -> None:
    """A1-READY-1: the readiness probe must HEAD the bucket (check_bucket), never
    perform the control-plane write ensure_bucket does."""
    spy = _SpyStorage()
    monkeypatch.setattr(health_mod, "get_storage", lambda: spy)
    monkeypatch.setattr(health_mod, "get_session_maker", lambda: (lambda: _FakeSession()))
    monkeypatch.setattr(health_mod, "get_redis", lambda: _FakeRedis())

    response = await health_mod.readiness()

    assert response.status_code == 200
    assert spy.check_called is True
    assert spy.ensure_called is False
    body = json.loads(bytes(response.body))
    assert body["status"] == "ready"
    assert body["checks"]["storage"] == "ok"
