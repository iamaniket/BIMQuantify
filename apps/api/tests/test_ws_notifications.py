"""WebSocket notification auth.

`/ws/notifications` must enforce the SAME token gates as the HTTP path —
the per-user `tokens_valid_after` epoch and `is_active` — plus a live
org-membership re-check, not merely the JTI blocklist. Otherwise a token
killed by "sign out everywhere" / password change / deactivation, or a
deprovisioned membership, would keep a live notification stream open until
natural token expiry.

Auth-decision tests exercise the extracted `authenticate_ws_token` helper
directly (a full WebSocket handshake over the in-memory ASGI transport is not
needed to prove the decision). The lifetime tests at the bottom drive
`_revalidation_loop` against a FakeWebSocket: once authenticated, an open socket
must keep re-checking those same gates and close promptly when any of them
starts failing — and recycle itself before its access token can expire (H5).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import delete

from bimdossier_api import db as db_module
from bimdossier_api.auth.tokens import decode_token_full
from bimdossier_api.cache import client as cache_module
from bimdossier_api.cache.blocklist import revoke_jti
from bimdossier_api.models.organization_member import OrganizationMember
from bimdossier_api.models.user import User
from bimdossier_api.routers.ws_notifications import (
    WS_CLOSE_AUTH_FAILED,
    WS_CLOSE_SESSION_REFRESH,
    _OneShotCloser,
    _revalidation_loop,
    authenticate_ws_token,
)

if TYPE_CHECKING:
    from redis.asyncio import Redis
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


async def test_ws_auth_success_returns_user_and_org(
    org_user: dict[str, str],
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        result = await authenticate_ws_token(org_user["access_token"], redis_client, session)
    assert not isinstance(result, str), result
    user, org_id = result
    assert str(user.id) == org_user["id"]
    assert str(org_id) == org_user["organization_id"]


async def test_ws_auth_rejects_token_predating_epoch(
    org_user: dict[str, str],
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A "sign out everywhere" / password change after the token was minted
    (epoch bumped past the token's iat) must reject the WS connection."""
    async with session_maker() as session:
        user = await session.get(User, UUID(org_user["id"]))
        assert user is not None
        user.tokens_valid_after = datetime.now(UTC) + timedelta(seconds=60)
        await session.commit()

    async with session_maker() as session:
        result = await authenticate_ws_token(org_user["access_token"], redis_client, session)
    assert result == "token_revoked"


async def test_ws_auth_rejects_deactivated_user(
    org_user: dict[str, str],
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        user = await session.get(User, UUID(org_user["id"]))
        assert user is not None
        user.is_active = False
        await session.commit()

    async with session_maker() as session:
        result = await authenticate_ws_token(org_user["access_token"], redis_client, session)
    assert result == "user_not_found"


async def test_ws_auth_rejects_revoked_membership(
    org_user: dict[str, str],
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A deprovisioned member must not keep streaming their old org's feed."""
    async with session_maker() as session:
        await session.execute(
            delete(OrganizationMember).where(
                OrganizationMember.user_id == UUID(org_user["id"]),
                OrganizationMember.organization_id == UUID(org_user["organization_id"]),
            )
        )
        await session.commit()

    async with session_maker() as session:
        result = await authenticate_ws_token(org_user["access_token"], redis_client, session)
    assert result == "org_membership_required"


# --- Continuous re-validation (H5) -------------------------------------------
#
# These drive `_revalidation_loop` directly with a FakeWebSocket. The loop reaches
# the DB/Redis via the module-global accessors `get_session_maker()` / `get_redis()`;
# the `org_user` fixture (via `client`) already points those at the test instances,
# but we re-pin them explicitly so the intent is local to the test. A tiny interval
# keeps the loop fast; an `asyncio.wait_for` ceiling turns any hang into a fast
# failure instead of a stuck suite.


class FakeWebSocket:
    """Stand-in for the slice of `starlette.WebSocket` the close path touches.

    Records the close code/reason and — like Starlette — raises on a second
    `close`, so a test can prove the one-shot guard actually prevents a duplicate
    close frame.
    """

    def __init__(self) -> None:
        self.close_calls = 0
        self.close_code: int | None = None
        self.close_reason: str | None = None

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        if self.close_calls > 0:
            raise RuntimeError('Cannot call "send" once a close message has been sent.')
        self.close_calls += 1
        self.close_code = code
        self.close_reason = reason


def _pin_globals(session_maker: async_sessionmaker[AsyncSession], redis_client: Redis) -> None:
    db_module._session_maker = session_maker
    cache_module._redis = redis_client


async def _drive_loop_to_close(token: str, *, max_lifetime_seconds: float = 5.0) -> FakeWebSocket:
    """Run the revalidation loop until it closes the socket, then return the fake."""
    fake = FakeWebSocket()
    closer = _OneShotCloser(fake)  # type: ignore[arg-type]
    await asyncio.wait_for(
        _revalidation_loop(
            token,
            close=closer,
            interval_seconds=0.02,
            max_lifetime_seconds=max_lifetime_seconds,
        ),
        timeout=2.0,
    )
    return fake


async def test_revalidation_loop_closes_when_membership_revoked_mid_stream(
    org_user: dict[str, str],
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The headline H5 case: a socket that authenticated fine must stay open while
    the member is active, then close on the first cycle after deprovisioning."""
    _pin_globals(session_maker, redis_client)
    fake = FakeWebSocket()
    closer = _OneShotCloser(fake)  # type: ignore[arg-type]
    loop_task = asyncio.create_task(
        _revalidation_loop(
            org_user["access_token"],
            close=closer,
            interval_seconds=0.02,
            max_lifetime_seconds=5.0,
        )
    )
    try:
        # Several cycles elapse while the membership is active: the socket stays open.
        await asyncio.sleep(0.1)
        assert not loop_task.done()
        assert fake.close_calls == 0

        async with session_maker() as session:
            await session.execute(
                delete(OrganizationMember).where(
                    OrganizationMember.user_id == UUID(org_user["id"]),
                    OrganizationMember.organization_id == UUID(org_user["organization_id"]),
                )
            )
            await session.commit()

        await asyncio.wait_for(loop_task, timeout=2.0)
    finally:
        loop_task.cancel()
    assert fake.close_calls == 1
    assert fake.close_code == WS_CLOSE_AUTH_FAILED
    assert fake.close_reason == "org_membership_required"


async def test_revalidation_loop_closes_on_epoch_bump(
    org_user: dict[str, str],
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A "sign out everywhere" / password change bumps the epoch past the token's
    iat; the loop must close the open socket."""
    _pin_globals(session_maker, redis_client)
    async with session_maker() as session:
        user = await session.get(User, UUID(org_user["id"]))
        assert user is not None
        user.tokens_valid_after = datetime.now(UTC) + timedelta(seconds=60)
        await session.commit()

    fake = await _drive_loop_to_close(org_user["access_token"])
    assert fake.close_code == WS_CLOSE_AUTH_FAILED
    assert fake.close_reason == "token_revoked"


async def test_revalidation_loop_closes_on_deactivation(
    org_user: dict[str, str],
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    _pin_globals(session_maker, redis_client)
    async with session_maker() as session:
        user = await session.get(User, UUID(org_user["id"]))
        assert user is not None
        user.is_active = False
        await session.commit()

    fake = await _drive_loop_to_close(org_user["access_token"])
    assert fake.close_code == WS_CLOSE_AUTH_FAILED
    assert fake.close_reason == "user_not_found"


async def test_revalidation_loop_closes_on_jti_blocklist(
    org_user: dict[str, str],
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A single-session logout blocklists the presented token's JTI; the loop must
    close the socket that token opened."""
    _pin_globals(session_maker, redis_client)
    decoded = decode_token_full(org_user["access_token"], "access")
    assert decoded.jti is not None
    await revoke_jti(redis_client, decoded.jti, 300)

    fake = await _drive_loop_to_close(org_user["access_token"])
    assert fake.close_code == WS_CLOSE_AUTH_FAILED
    assert fake.close_reason == "token_revoked"


async def test_revalidation_loop_recycles_at_max_lifetime(
    org_user: dict[str, str],
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """With nothing revoked, the loop keeps the socket open across cycles and then
    closes it with a benign `session_refresh` once the lifetime cap is hit — never
    a spurious 4001 auth rejection."""
    _pin_globals(session_maker, redis_client)
    fake = await _drive_loop_to_close(org_user["access_token"], max_lifetime_seconds=0.08)
    assert fake.close_calls == 1
    assert fake.close_code == WS_CLOSE_SESSION_REFRESH
    assert fake.close_reason == "session_refresh"


async def test_oneshot_closer_sends_single_close_frame() -> None:
    """The guard collapses repeated close attempts (revalidation loop racing
    `manager.stop()` on shutdown) into one close frame — the first wins."""
    fake = FakeWebSocket()
    closer = _OneShotCloser(fake)  # type: ignore[arg-type]
    await closer(WS_CLOSE_AUTH_FAILED, "token_revoked")
    await closer(WS_CLOSE_SESSION_REFRESH, "session_refresh")
    assert fake.close_calls == 1
    assert fake.close_code == WS_CLOSE_AUTH_FAILED
    assert fake.close_reason == "token_revoked"
