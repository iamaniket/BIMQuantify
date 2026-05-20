from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.conftest import _TEST_PASSWORD, make_test_user


async def _login(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email: str,
    full_name: str = "Me",
) -> dict[str, str]:
    await make_test_user(session_maker, email=email, full_name=full_name)
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": _TEST_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_me_returns_current_user(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    tokens = await _login(client, session_maker, "ken@example.com", full_name="Me")
    response = await client.get(
        "/users/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["email"] == "ken@example.com"
    assert body["full_name"] == "Me"
    assert body["is_verified"] is True


async def test_me_without_token_is_unauthorized(client: AsyncClient) -> None:
    response = await client.get("/users/me")
    assert response.status_code == 401


async def test_me_rejects_refresh_token(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    tokens = await _login(client, session_maker, "lee@example.com")
    response = await client.get(
        "/users/me",
        headers={"Authorization": f"Bearer {tokens['refresh_token']}"},
    )
    assert response.status_code == 401
