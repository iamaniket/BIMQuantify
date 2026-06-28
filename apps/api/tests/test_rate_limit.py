from collections.abc import AsyncGenerator
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from starlette.requests import Request

from bimdossier_api.auth.ratelimit import (
    CAPTURE_INITIATE_LIMITER,
    INVITE_LIMITER,
    UPLOAD_INITIATE_LIMITER,
    make_identifier,
)
from bimdossier_api.config import get_settings
from tests.conftest import (
    FakeStorage,
    _auth,
    _create_document,
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


async def test_login_fails_open_when_redis_unavailable(
    rate_limited_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Redis outage during a rate-limit check must NOT 500 the auth surface.

    The limiter is a throttle, not an auth gate: `ResilientRateLimiter` swallows
    the `RedisError` and lets the request through, so a bad-cred login still gets
    its normal 400 — not a 500, and not a spurious 429. Without the fail-open
    override this raised an uncaught error and FastAPI returned 500 (finding B7).
    """
    from fastapi_limiter import FastAPILimiter
    from redis.exceptions import ConnectionError as RedisConnectionError

    async def _boom(*args: object, **kwargs: object) -> object:
        raise RedisConnectionError("redis is down")

    # Break the underlying Lua `evalsha` so the real `_check` except-clause runs
    # end-to-end, rather than stubbing the override under test. Only the limiter
    # uses evalsha, so login itself is otherwise unaffected.
    monkeypatch.setattr(FastAPILimiter.redis, "evalsha", _boom)

    response = await rate_limited_client.post(
        "/auth/jwt/login",
        data={"username": "missing@example.com", "password": "whatever"},
    )

    assert response.status_code == 400, response.text  # LOGIN_BAD_CREDENTIALS
    assert response.status_code not in (429, 500)


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
# X-Forwarded-For spoofing — an unauthenticated attacker must NOT be able to
# rotate the XFF header to mint a fresh login/refresh rate-limit bucket. With
# no trusted proxy configured (the default), client identity is the real peer
# IP and the spoofed header is ignored.
# ---------------------------------------------------------------------------


def _http_request_xff(
    xff: str, *, client_host: str = "5.5.5.5", path: str = "/auth/jwt/login"
) -> Request:
    return Request(
        {
            "type": "http",
            "headers": [(b"x-forwarded-for", xff.encode())],
            "client": (client_host, 12345),
            "state": {},
            "path": path,
        }
    )


async def test_client_ip_ignores_xff_from_untrusted_peer() -> None:
    from bimdossier_api.auth.ratelimit import _client_ip

    # Default config has no trusted proxies → the spoofed header is ignored.
    assert _client_ip(_http_request_xff("9.9.9.9", client_host="1.2.3.4")) == "1.2.3.4"


async def test_default_identifier_unaffected_by_rotating_xff() -> None:
    from bimdossier_api.auth.ratelimit import default_rate_limit_identifier

    a = await default_rate_limit_identifier(_http_request_xff("1.1.1.1"))
    b = await default_rate_limit_identifier(_http_request_xff("2.2.2.2"))
    # Same real peer, different spoofed XFF → SAME bucket (rotation is useless).
    assert a == b == "5.5.5.5:/auth/jwt/login"


async def test_who_ignores_rotating_xff_for_unauthenticated() -> None:
    from bimdossier_api.auth.ratelimit import _who

    a = _who(_http_request_xff("1.1.1.1"))
    b = _who(_http_request_xff("2.2.2.2"))
    assert a == b == "ip:5.5.5.5"


async def test_client_ip_honors_xff_behind_trusted_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from bimdossier_api.auth import ratelimit as ratelimit_module

    # When the immediate peer IS the configured trusted proxy, the right-most
    # forwarded hop (the address the proxy observed) is used.
    patched = get_settings().model_copy(update={"trusted_proxy_ips": "5.5.5.5"})
    monkeypatch.setattr(ratelimit_module, "get_settings", lambda: patched)

    req = _http_request_xff("203.0.113.7", client_host="5.5.5.5")
    assert ratelimit_module._client_ip(req) == "203.0.113.7"

    # A direct attacker (peer not in the allowlist) is still ignored.
    direct = _http_request_xff("203.0.113.7", client_host="6.6.6.6")
    assert ratelimit_module._client_ip(direct) == "6.6.6.6"


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

    from bimdossier_api import db as db_module
    from bimdossier_api.cache import client as cache_module
    from bimdossier_api.main import create_app
    from bimdossier_api.storage import get_storage

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
    model = await _create_document(client, token, project["id"])
    url = f"/projects/{project['id']}/documents/{model['id']}/files/initiate"

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


# ---------------------------------------------------------------------------
# Mail-bomb / enumeration vectors: invite + resend both share INVITE_LIMITER.
# ---------------------------------------------------------------------------


async def test_invite_member_enforces_rate_limit(
    org_user: dict[str, str],
    rate_limited_client: AsyncClient,
    # In-memory transport so the first invite email is captured, not SMTP'd.
    email_transport: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(INVITE_LIMITER, "times", 1)
    client = rate_limited_client
    token = org_user["access_token"]
    url = f"/organizations/{org_user['organization_id']}/members"

    first = await client.post(
        url, json={"email": "rl-invite-1@example.com"}, headers=_auth(token)
    )
    second = await client.post(
        url, json={"email": "rl-invite-2@example.com"}, headers=_auth(token)
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 429


async def test_resend_invite_enforces_rate_limit(
    org_user: dict[str, str],
    rate_limited_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Shares the "org_invite" budget. Target a non-existent member so the handler
    # 404s — the limiter still counts the call (it runs before the handler), so the
    # second request trips 429 and proves the decorator is wired onto resend.
    monkeypatch.setattr(INVITE_LIMITER, "times", 1)
    client = rate_limited_client
    token = org_user["access_token"]
    url = f"/organizations/{org_user['organization_id']}/members/{uuid4()}/resend-invite"

    first = await client.post(url, headers=_auth(token))
    second = await client.post(url, headers=_auth(token))

    assert first.status_code != 429, first.text
    assert second.status_code == 429


# ---------------------------------------------------------------------------
# Presigned-PUT minting siblings — all share the one UPLOAD_INITIATE_LIMITER
# budget (label "upload_initiate"). One representative test per newly-wired route.
# ---------------------------------------------------------------------------


async def test_attachment_initiate_enforces_rate_limit(
    org_user: dict[str, str],
    limited_fake_storage_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(UPLOAD_INITIATE_LIMITER, "times", 1)
    client = limited_fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    url = f"/projects/{project['id']}/attachments/initiate"

    def _payload() -> dict[str, object]:
        return {
            "filename": "photo.jpg",
            "size_bytes": 2048,
            "content_type": "image/jpeg",
            "content_sha256": _new_hash(),
        }

    first = await client.post(url, json=_payload(), headers=_auth(token))
    second = await client.post(url, json=_payload(), headers=_auth(token))

    assert first.status_code == 201, first.text
    assert second.status_code == 429


async def test_certificate_initiate_enforces_rate_limit(
    org_user: dict[str, str],
    limited_fake_storage_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(UPLOAD_INITIATE_LIMITER, "times", 1)
    client = limited_fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    url = f"/projects/{project['id']}/certificates/initiate"

    def _payload() -> dict[str, object]:
        return {
            "filename": "ce-cert.pdf",
            "size_bytes": 4096,
            "content_type": "application/pdf",
            "content_sha256": _new_hash(),
            "certificate_type": "product",
        }

    first = await client.post(url, json=_payload(), headers=_auth(token))
    second = await client.post(url, json=_payload(), headers=_auth(token))

    assert first.status_code == 201, first.text
    assert second.status_code == 429


async def test_org_certificate_initiate_enforces_rate_limit(
    org_user: dict[str, str],
    limited_fake_storage_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(UPLOAD_INITIATE_LIMITER, "times", 1)
    client = limited_fake_storage_client
    token = org_user["access_token"]
    url = "/org-certificates/initiate"

    def _payload() -> dict[str, object]:
        return {
            "filename": "org-cert.pdf",
            "size_bytes": 4096,
            "content_type": "application/pdf",
            "content_sha256": _new_hash(),
            "certificate_type": "product",
        }

    first = await client.post(url, json=_payload(), headers=_auth(token))
    second = await client.post(url, json=_payload(), headers=_auth(token))

    assert first.status_code == 201, first.text
    assert second.status_code == 429


async def test_template_asset_initiate_enforces_rate_limit(
    org_user: dict[str, str],
    limited_fake_storage_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(UPLOAD_INITIATE_LIMITER, "times", 1)
    client = limited_fake_storage_client
    token = org_user["access_token"]
    url = "/org-templates/assets/initiate"

    def _payload() -> dict[str, object]:
        return {
            "asset_kind": "logo",
            "filename": "brand.png",
            "content_type": "image/png",
            "size_bytes": 4096,
        }

    first = await client.post(url, json=_payload(), headers=_auth(token))
    second = await client.post(url, json=_payload(), headers=_auth(token))

    assert first.status_code == 201, first.text
    assert second.status_code == 429


# ---------------------------------------------------------------------------
# Public, unauthenticated capture-link upload-initiate — its own per-IP budget.
# ---------------------------------------------------------------------------


async def test_capture_initiate_enforces_rate_limit(
    org_user: dict[str, str],
    limited_fake_storage_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(CAPTURE_INITIATE_LIMITER, "times", 1)
    client = limited_fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)

    link_resp = await client.post(
        f"/projects/{project['id']}/capture-links",
        json={"label": "RL link", "ttl_hours": 24},
        headers=_auth(token),
    )
    assert link_resp.status_code == 201, link_resp.text
    capture_token = link_resp.json()["token"]
    org_id = org_user["organization_id"]
    url = f"/public/capture/{org_id}/{capture_token}/initiate"

    def _payload() -> dict[str, object]:
        return {
            "filename": "site-photo.jpg",
            "size_bytes": 4096,
            "content_type": "image/jpeg",
            "content_sha256": _new_hash(),
        }

    # Unauthenticated (no auth header) — keys per-IP via the _who fallback.
    first = await client.post(url, json=_payload())
    second = await client.post(url, json=_payload())

    assert first.status_code == 201, first.text
    assert second.status_code == 429
