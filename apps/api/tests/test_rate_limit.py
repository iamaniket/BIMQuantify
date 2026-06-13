from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from starlette.requests import Request

from bimstitch_api.auth.ratelimit import UPLOAD_INITIATE_LIMITER, make_identifier
from bimstitch_api.config import get_settings
from tests.conftest import (
    FakeStorage,
    _auth,
    _create_model,
    _create_project,
    _new_hash,
)


async def test_login_rate_limit_returns_429(rate_limited_client: AsyncClient) -> None:
    settings = get_settings()
    limit = settings.rate_limit_login_per_min
    last_status: int | None = None

    for _ in range(limit + 1):
        response = await rate_limited_client.post(
            "/auth/jwt/login",
            data={"username": "missing@example.com", "password": "whatever"},
        )
        last_status = response.status_code

    assert last_status == 429


# ---------------------------------------------------------------------------
# Per-user identifier — the security-relevant novelty: budgets key on the
# authenticated user, not the client IP (so a shared NAT can't share a budget).
# ---------------------------------------------------------------------------


class _FakeDecoded:
    def __init__(self, user_id: str) -> None:
        self.user_id = user_id


def _http_request(*, state: dict | None = None, client_host: str = "1.2.3.4") -> Request:
    return Request(
        {
            "type": "http",
            "headers": [],
            "client": (client_host, 12345),
            "state": {} if state is None else state,
        }
    )


async def test_identifier_keys_on_authenticated_user() -> None:
    ident = make_identifier("compliance_check")
    req = _http_request(state={"decoded_token": _FakeDecoded("alice-uuid")})
    assert await ident(req) == "user:alice-uuid:compliance_check"


async def test_identifier_falls_back_to_client_ip() -> None:
    ident = make_identifier("compliance_check")
    req = _http_request(client_host="9.9.9.9")
    assert await ident(req) == "ip:9.9.9.9:compliance_check"


async def test_identifier_gives_distinct_users_distinct_budgets() -> None:
    ident = make_identifier("report_create")
    a = await ident(_http_request(state={"decoded_token": _FakeDecoded("a")}))
    b = await ident(_http_request(state={"decoded_token": _FakeDecoded("b")}))
    assert a != b


# ---------------------------------------------------------------------------
# End-to-end: the upload-initiate endpoint actually enforces its limiter.
# ---------------------------------------------------------------------------


@pytest.fixture
async def limited_fake_storage_client(
    engine: AsyncEngine,
    session_maker: async_sessionmaker[AsyncSession],
    redis_client: Redis,
) -> AsyncGenerator[AsyncClient, None]:
    """Like `fake_storage_client` but with rate limiting ACTIVE (limiters not
    overridden). Shares the test DB/Redis so a token from `org_user` is valid."""
    from fastapi_limiter import FastAPILimiter

    from bimstitch_api import db as db_module
    from bimstitch_api.cache import client as cache_module
    from bimstitch_api.main import create_app
    from bimstitch_api.storage import get_storage

    db_module._engine = engine
    db_module._session_maker = session_maker
    cache_module._redis = redis_client

    await FastAPILimiter.init(redis_client)
    try:
        app = create_app()
        fake = FakeStorage()
        app.dependency_overrides[get_storage] = lambda: fake
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        await FastAPILimiter.close()


async def test_initiate_enforces_per_user_rate_limit(
    org_user: dict[str, str],
    limited_fake_storage_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Squeeze the budget to a single call so the second initiate trips 429.
    monkeypatch.setattr(UPLOAD_INITIATE_LIMITER, "times", 1)
    client = limited_fake_storage_client
    token = org_user["access_token"]

    project = await _create_project(client, token)
    model = await _create_model(client, token, project["id"])
    url = f"/projects/{project['id']}/models/{model['id']}/files/initiate"

    def _payload() -> dict[str, object]:
        return {
            "filename": "model.ifc",
            "size_bytes": 1024,
            "content_type": "application/octet-stream",
            "content_sha256": _new_hash(),
        }

    first = await client.post(url, json=_payload(), headers=_auth(token))
    second = await client.post(url, json=_payload(), headers=_auth(token))

    assert first.status_code == 201, first.text
    assert second.status_code == 429
