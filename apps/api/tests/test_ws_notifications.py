"""WebSocket notification auth.

`/ws/notifications` must enforce the SAME token gates as the HTTP path —
the per-user `tokens_valid_after` epoch and `is_active` — plus a live
org-membership re-check, not merely the JTI blocklist. Otherwise a token
killed by "sign out everywhere" / password change / deactivation, or a
deprovisioned membership, would keep a live notification stream open until
natural token expiry.

These exercise the extracted `authenticate_ws_token` helper directly (a full
WebSocket handshake over the in-memory ASGI transport is not needed to prove
the auth decision).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import delete

from bimstitch_api.models.organization_member import OrganizationMember
from bimstitch_api.models.user import User
from bimstitch_api.routers.ws_notifications import authenticate_ws_token

if TYPE_CHECKING:
    from redis.asyncio import Redis
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


async def test_ws_auth_success_returns_user_and_org(
    org_user: dict[str, str],
    redis_client: Redis,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        result = await authenticate_ws_token(
            org_user["access_token"], redis_client, session
        )
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
        result = await authenticate_ws_token(
            org_user["access_token"], redis_client, session
        )
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
        result = await authenticate_ws_token(
            org_user["access_token"], redis_client, session
        )
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
        result = await authenticate_ws_token(
            org_user["access_token"], redis_client, session
        )
    assert result == "org_membership_required"
