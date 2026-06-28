"""Per-account login lockout + alerting + recovery (security finding H6).

The login endpoint gains a second throttle keyed on the normalized account
email (Redis failed-attempt counter → temporary, backing-off lockout) that is
independent of source IP, so distributed credential stuffing (IP rotation
against one account) is bounded. When an account locks, org admins + platform
super-admins are alerted (audit + in-app notification + email). Recovery is via
auto-expiry, password reset (clears the lock), or a super-admin unlock.

These tests use the plain ``client`` fixture: it overrides the per-IP
``LOGIN_RATE_LIMITER`` to a no-op (so the per-IP 5/min limiter can't interfere)
while the handler's own account-lockout logic still runs against the test Redis.
The threshold is pinned low by patching ``routes.get_settings``.
"""

import re
from uuid import uuid4

import pytest
from httpx import AsyncClient
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.auth import lockout
from bimdossier_api.config import get_settings
from tests.conftest import _TEST_PASSWORD, _auth, _latest_audit, make_test_user

WRONG_PASSWORD = "definitely-not-the-password-zzz"


def _patch_threshold(
    monkeypatch: pytest.MonkeyPatch,
    *,
    max_attempts: int = 3,
    window: int = 900,
    base: int = 900,
    cap: int = 86400,
) -> None:
    """Pin the lockout policy the login handler reads (it calls get_settings()
    inside the request, so we patch the name in the routes module)."""
    from bimdossier_api.auth import routes as routes_module

    patched = get_settings().model_copy(
        update={
            "login_lockout_max_attempts": max_attempts,
            "login_lockout_window_seconds": window,
            "login_lockout_base_seconds": base,
            "login_lockout_max_seconds": cap,
        }
    )
    monkeypatch.setattr(routes_module, "get_settings", lambda: patched)


async def _fail_login(client: AsyncClient, email: str) -> object:
    return await client.post(
        "/auth/jwt/login", data={"username": email, "password": WRONG_PASSWORD}
    )


async def _login(client: AsyncClient, email: str, password: str = _TEST_PASSWORD) -> object:
    return await client.post("/auth/jwt/login", data={"username": email, "password": password})


# ---------------------------------------------------------------------------
# Core lockout behaviour (HTTP)
# ---------------------------------------------------------------------------


async def test_failed_attempts_lock_account(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_threshold(monkeypatch, max_attempts=3)
    email = "lockme@example.com"
    await make_test_user(session_maker, email=email)

    r1 = await _fail_login(client, email)
    r2 = await _fail_login(client, email)
    r3 = await _fail_login(client, email)

    assert r1.status_code == 400 and r1.json()["detail"] == "LOGIN_BAD_CREDENTIALS"
    assert r2.status_code == 400 and r2.json()["detail"] == "LOGIN_BAD_CREDENTIALS"
    assert r3.status_code == 429, r3.text
    assert r3.json()["detail"] == "LOGIN_ACCOUNT_LOCKED"
    assert r3.headers.get("Retry-After")  # non-empty seconds value


async def test_lock_blocks_correct_password(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The key security assertion: once locked, even the CORRECT password is
    rejected (the gate runs before authenticate)."""
    _patch_threshold(monkeypatch, max_attempts=3)
    email = "victim@example.com"
    await make_test_user(session_maker, email=email)

    for _ in range(3):
        await _fail_login(client, email)

    resp = await _login(client, email)  # correct password
    assert resp.status_code == 429, resp.text
    assert resp.json()["detail"] == "LOGIN_ACCOUNT_LOCKED"


async def test_success_resets_counter(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_threshold(monkeypatch, max_attempts=3)
    email = "resetme@example.com"
    await make_test_user(session_maker, email=email)

    await _fail_login(client, email)  # 1
    await _fail_login(client, email)  # 2
    ok = await _login(client, email)
    assert ok.status_code == 200, ok.text  # success clears the counter

    r1 = await _fail_login(client, email)  # 1 again
    r2 = await _fail_login(client, email)  # 2 again — still below threshold
    assert r1.status_code == 400
    assert r2.status_code == 400, "counter should have reset on the successful login"


async def test_lock_keys_on_account_not_ip(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_threshold(monkeypatch, max_attempts=3)
    a = "accta@example.com"
    b = "acctb@example.com"
    await make_test_user(session_maker, email=a)
    await make_test_user(session_maker, email=b)

    for _ in range(3):
        await _fail_login(client, a)  # lock account A

    # Account B, same client/IP, still logs in — the lock keys on the account.
    resp = await _login(client, b)
    assert resp.status_code == 200, resp.text


async def test_unknown_email_locks_without_alert(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unknown email locks identically (no account enumeration) but produces
    no alert (no user to attribute it to)."""
    _patch_threshold(monkeypatch, max_attempts=3)
    email = "ghost@nowhere.test"

    last = None
    for _ in range(3):
        last = await _fail_login(client, email)
    assert last is not None and last.status_code == 429
    assert last.json()["detail"] == "LOGIN_ACCOUNT_LOCKED"

    assert await _latest_audit(session_maker, "auth.account_locked") is None
    assert email_transport.sent == []  # type: ignore[attr-defined]


async def test_lock_is_case_insensitive(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_threshold(monkeypatch, max_attempts=3)
    for _ in range(3):
        await _fail_login(client, "Mixed@Case.test")

    resp = await client.post(
        "/auth/jwt/login", data={"username": "mixed@case.test", "password": WRONG_PASSWORD}
    )
    assert resp.status_code == 429, resp.text
    assert resp.json()["detail"] == "LOGIN_ACCOUNT_LOCKED"


async def test_unverified_user_does_not_accumulate_lock(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_threshold(monkeypatch, max_attempts=3)
    email = "unverified@example.com"
    await make_test_user(session_maker, email=email, is_verified=False)

    # Correct password for an unverified account → never a "failed credential"
    # attempt, so it must never accumulate toward a lock.
    for _ in range(4):
        resp = await _login(client, email)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "LOGIN_USER_NOT_VERIFIED"


# ---------------------------------------------------------------------------
# Alert pipeline
# ---------------------------------------------------------------------------


async def test_lockout_audits_and_alerts_org_admin(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_threshold(monkeypatch, max_attempts=3)
    victim = same_org_non_admin_user  # Dave, non-admin in AlphaCo
    admin = org_user  # Alice, admin in AlphaCo

    last = None
    for _ in range(3):
        last = await _fail_login(client, victim["email"])
    assert last is not None and last.status_code == 429

    # (a) Audit row — correct fields, no secrets.
    row = await _latest_audit(session_maker, "auth.account_locked")
    assert row is not None
    assert row.after["email"] == victim["email"]
    assert row.after["attempts"] == 3
    assert row.after["reason"] == "too_many_failed_attempts"
    assert "password" not in row.after and "hashed_password" not in row.after

    # (b) Admin sees the targeted in-app notification.
    feed = (await client.get("/notifications", headers=_auth(admin["access_token"]))).json()
    locked_items = [n for n in feed["items"] if n["event_type"] == "account_locked"]
    assert len(locked_items) >= 1
    assert victim["email"] in locked_items[0]["body"]

    # (c) Admin got the email.
    msg = email_transport.last_for(admin["email"])  # type: ignore[attr-defined]
    assert msg is not None
    assert victim["email"] in msg.body
    assert _TEST_PASSWORD not in msg.body  # never leak credentials

    # (d) The non-admin (the victim) does NOT see the admin-targeted notification.
    victim_feed = (await client.get("/notifications", headers=_auth(victim["access_token"]))).json()
    assert not [n for n in victim_feed["items"] if n["event_type"] == "account_locked"]


async def test_lockout_emails_super_admin(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    superuser_in_org: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_threshold(monkeypatch, max_attempts=3)
    victim = same_org_non_admin_user

    for _ in range(3):
        await _fail_login(client, victim["email"])

    msg = email_transport.last_for(superuser_in_org["email"])  # type: ignore[attr-defined]
    assert msg is not None
    assert victim["email"] in msg.body


async def test_alert_email_failure_does_not_break_login(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_threshold(monkeypatch, max_attempts=3)

    async def _boom(*args: object, **kwargs: object) -> None:
        raise RuntimeError("smtp down")

    monkeypatch.setattr(email_transport, "send", _boom)
    victim = same_org_non_admin_user

    last = None
    for _ in range(3):
        last = await _fail_login(client, victim["email"])
    # The login response is unaffected by the failing alert email.
    assert last is not None and last.status_code == 429
    assert last.json()["detail"] == "LOGIN_ACCOUNT_LOCKED"

    # Audit + in-app notification still recorded (both happen before the email).
    assert await _latest_audit(session_maker, "auth.account_locked") is not None
    feed = (await client.get("/notifications", headers=_auth(org_user["access_token"]))).json()
    assert any(n["event_type"] == "account_locked" for n in feed["items"])


# ---------------------------------------------------------------------------
# Recovery: password reset clears the lock; super-admin unlock; locked badge
# ---------------------------------------------------------------------------


async def test_password_reset_clears_lock(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_threshold(monkeypatch, max_attempts=3)
    email = "resetlock@example.com"
    await make_test_user(session_maker, email=email)

    for _ in range(3):
        await _fail_login(client, email)
    assert (await _login(client, email)).status_code == 429  # locked

    forgot = await client.post("/auth/forgot-password", json={"email": email})
    assert forgot.status_code == 202, forgot.text
    sent = email_transport.last_for(email)  # type: ignore[attr-defined]
    assert sent is not None
    match = re.search(r"Token:\s*(\S+)", sent.body)
    assert match is not None
    token = match.group(1)

    new_password = "fresh-horse-staple-67"
    reset = await client.post(
        "/auth/reset-password", json={"token": token, "password": new_password}
    )
    assert reset.status_code == 200, reset.text

    # Lock cleared by on_after_reset_password → login with the new password works.
    ok = await _login(client, email, password=new_password)
    assert ok.status_code == 200, ok.text


async def test_super_admin_can_unlock(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    superuser_in_org: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_threshold(monkeypatch, max_attempts=3)
    email = "unlockme@example.com"
    victim_id = await make_test_user(session_maker, email=email)

    for _ in range(3):
        await _fail_login(client, email)
    assert (await _login(client, email)).status_code == 429  # locked

    resp = await client.post(
        f"/admin/users/{victim_id}/unlock",
        headers=_auth(superuser_in_org["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["locked"] is False

    # Login works again, and the action is audited.
    assert (await _login(client, email)).status_code == 200
    assert await _latest_audit(session_maker, "user.unlocked") is not None


async def test_org_admin_cannot_unlock(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
) -> None:
    """Unlock is super-admin only — a plain org admin gets 403."""
    victim_id = await make_test_user(session_maker, email="target@example.com")
    resp = await client.post(
        f"/admin/users/{victim_id}/unlock",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "SUPERUSER_REQUIRED"


async def test_unlock_unknown_user_404(
    client: AsyncClient,
    superuser_in_org: dict[str, str],
) -> None:
    resp = await client.post(
        f"/admin/users/{uuid4()}/unlock",
        headers=_auth(superuser_in_org["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "USER_NOT_FOUND"


async def test_locked_badge_in_user_list(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    superuser_in_org: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_threshold(monkeypatch, max_attempts=3)
    locked_email = "badged@example.com"
    free_email = "free@example.com"
    await make_test_user(session_maker, email=locked_email)
    await make_test_user(session_maker, email=free_email)

    for _ in range(3):
        await _fail_login(client, locked_email)

    resp = await client.get("/admin/users", headers=_auth(superuser_in_org["access_token"]))
    assert resp.status_code == 200, resp.text
    by_email = {u["email"]: u for u in resp.json()}
    assert by_email[locked_email]["locked"] is True
    assert by_email[free_email]["locked"] is False


# ---------------------------------------------------------------------------
# Unit tests against lockout.py directly
# ---------------------------------------------------------------------------


def _unit_settings(*, max_attempts: int = 3, window: int = 900, base: int = 10, cap: int = 40):
    return get_settings().model_copy(
        update={
            "login_lockout_max_attempts": max_attempts,
            "login_lockout_window_seconds": window,
            "login_lockout_base_seconds": base,
            "login_lockout_max_seconds": cap,
        }
    )


async def test_register_failure_locks_at_threshold(redis_client: Redis) -> None:
    s = _unit_settings(max_attempts=3, base=10, cap=40)
    u = "unit-lock@example.com"

    r1 = await lockout.register_failure(redis_client, u, s)
    r2 = await lockout.register_failure(redis_client, u, s)
    r3 = await lockout.register_failure(redis_client, u, s)

    assert (r1.locked, r1.just_locked, r1.fail_count) == (False, False, 1)
    assert (r2.locked, r2.just_locked, r2.fail_count) == (False, False, 2)
    assert r3.locked and r3.just_locked and r3.fail_count == 3
    assert r3.retry_after == 10  # base, first lockout

    locked, retry = await lockout.is_locked(redis_client, u)
    assert locked and 0 < retry <= 10


async def test_backoff_doubles_and_caps(redis_client: Redis) -> None:
    s = _unit_settings(max_attempts=1, base=10, cap=25)
    u = "unit-backoff@example.com"
    h = lockout._hash(u)

    r1 = await lockout.register_failure(redis_client, u, s)  # lock #1 → 10
    assert r1.just_locked and r1.retry_after == 10

    # A further failure while locked reports the live lock, no new lockout.
    mid = await lockout.register_failure(redis_client, u, s)
    assert mid.locked and not mid.just_locked

    await redis_client.delete(f"{lockout.LOCK_PREFIX}{h}")  # simulate expiry
    r2 = await lockout.register_failure(redis_client, u, s)  # lock #2 → 20
    assert r2.just_locked and r2.retry_after == 20

    await redis_client.delete(f"{lockout.LOCK_PREFIX}{h}")
    r3 = await lockout.register_failure(redis_client, u, s)  # lock #3 → 40 capped to 25
    assert r3.just_locked and r3.retry_after == 25


async def test_clear_failures_deletes_all_keys(redis_client: Redis) -> None:
    s = _unit_settings(max_attempts=1, base=30)
    u = "unit-clear@example.com"
    h = lockout._hash(u)

    await lockout.register_failure(redis_client, u, s)  # locks → sets lock + lockcount
    assert await redis_client.exists(f"{lockout.LOCK_PREFIX}{h}")

    await lockout.clear_failures(redis_client, u)
    assert not await redis_client.exists(f"{lockout.LOCK_PREFIX}{h}")
    assert not await redis_client.exists(f"{lockout.LOCKCOUNT_PREFIX}{h}")
    assert not await redis_client.exists(f"{lockout.FAIL_PREFIX}{h}")
    locked, _ = await lockout.is_locked(redis_client, u)
    assert not locked


async def test_locked_map_batches(redis_client: Redis) -> None:
    s = _unit_settings(max_attempts=1, base=30)
    locked_email = "lm-locked@example.com"
    free_email = "lm-free@example.com"
    await lockout.register_failure(redis_client, locked_email, s)  # locks

    result = await lockout.locked_map(redis_client, [locked_email, free_email])
    assert result == {locked_email: True, free_email: False}
    assert await lockout.locked_map(redis_client, []) == {}


class _BrokenRedis:
    """A Redis stand-in whose every op raises, to prove fail-open behaviour."""

    async def ttl(self, *a: object, **k: object) -> object:
        raise RedisError("down")

    async def incr(self, *a: object, **k: object) -> object:
        raise RedisError("down")

    async def expire(self, *a: object, **k: object) -> object:
        raise RedisError("down")

    async def set(self, *a: object, **k: object) -> object:
        raise RedisError("down")

    async def delete(self, *a: object, **k: object) -> object:
        raise RedisError("down")

    def pipeline(self, *a: object, **k: object) -> object:
        raise RedisError("down")


async def test_is_locked_fails_open_on_redis_error() -> None:
    locked, retry = await lockout.is_locked(_BrokenRedis(), "x@example.com")  # type: ignore[arg-type]
    assert locked is False and retry == 0


async def test_register_failure_fails_open_on_redis_error() -> None:
    s = _unit_settings()
    r = await lockout.register_failure(_BrokenRedis(), "x@example.com", s)  # type: ignore[arg-type]
    assert r.locked is False and r.just_locked is False


async def test_locked_map_fails_open_on_redis_error() -> None:
    result = await lockout.locked_map(_BrokenRedis(), ["a@x.com", "b@x.com"])  # type: ignore[arg-type]
    assert result == {"a@x.com": False, "b@x.com": False}
