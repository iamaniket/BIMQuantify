"""Auth-decision tests for the free-tier notification WebSocket.

Exercise the extracted `authenticate_ws_pooled_token` helper: it enforces the SAME
token gates as the org path (JTI blocklist, user active, token epoch) but drops the
org-membership check (a free account is org-less). Mirrors `test_ws_notifications`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from uuid import UUID

from bimdossier_api.auth.tokens import decode_token_full
from bimdossier_api.cache.blocklist import revoke_jti
from bimdossier_api.models.user import User
from bimdossier_api.routers.ws_notifications import authenticate_ws_pooled_token
from tests.conftest import make_test_user

if TYPE_CHECKING:
    from httpx import AsyncClient
    from redis.asyncio import Redis
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

_PW = "correct-horse-battery"


async def _free_login(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email: str,
) -> tuple[str, str]:
    """Create + log in an org-less verified user. Returns (user_id, access_token)."""
    uid = await make_test_user(session_maker, email=email, is_verified=True)
    login = await client.post("/auth/jwt/login", data={"username": email, "password": _PW})
    assert login.status_code == 200, login.text
    return uid, login.json()["access_token"]


async def test_ws_free_auth_success_returns_user(
    client: AsyncClient,
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    uid, token = await _free_login(client, session_maker, "ws-free-ok@example.com")
    async with session_maker() as session:
        result = await authenticate_ws_pooled_token(token, redis_client, session)
    assert not isinstance(result, str), result
    assert str(result.id) == uid


async def test_ws_free_auth_rejects_token_predating_epoch(
    client: AsyncClient,
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    uid, token = await _free_login(client, session_maker, "ws-free-epoch@example.com")
    async with session_maker() as session:
        user = await session.get(User, UUID(uid))
        assert user is not None
        user.tokens_valid_after = datetime.now(UTC) + timedelta(seconds=60)
        await session.commit()

    async with session_maker() as session:
        result = await authenticate_ws_pooled_token(token, redis_client, session)
    assert result == "token_revoked"


async def test_ws_free_auth_rejects_deactivated_user(
    client: AsyncClient,
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    uid, token = await _free_login(client, session_maker, "ws-free-deact@example.com")
    async with session_maker() as session:
        user = await session.get(User, UUID(uid))
        assert user is not None
        user.is_active = False
        await session.commit()

    async with session_maker() as session:
        result = await authenticate_ws_pooled_token(token, redis_client, session)
    assert result == "user_not_found"


async def test_ws_free_auth_rejects_revoked_jti(
    client: AsyncClient,
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    _, token = await _free_login(client, session_maker, "ws-free-jti@example.com")
    decoded = decode_token_full(token, "access")
    assert decoded.jti is not None
    await revoke_jti(redis_client, decoded.jti, 60)

    async with session_maker() as session:
        result = await authenticate_ws_pooled_token(token, redis_client, session)
    assert result == "token_revoked"


async def test_ws_free_auth_rejects_invalid_token(
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        result = await authenticate_ws_pooled_token("not-a-jwt", redis_client, session)
    assert result == "invalid_token"
