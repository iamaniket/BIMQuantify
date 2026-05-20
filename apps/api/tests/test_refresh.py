from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.conftest import _TEST_PASSWORD, make_test_user


async def _login(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email: str,
) -> dict[str, str]:
    await make_test_user(session_maker, email=email)
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": _TEST_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_refresh_issues_new_access_token(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    tokens = await _login(client, session_maker, "ivy@example.com")
    response = await client.post(
        "/auth/jwt/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["access_token"]
    assert body["access_token"] != tokens["access_token"] or body["token_type"] == "bearer"


async def test_refresh_rejects_access_token(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    tokens = await _login(client, session_maker, "jane@example.com")
    response = await client.post(
        "/auth/jwt/refresh", json={"refresh_token": tokens["access_token"]}
    )
    assert response.status_code == 401


async def test_refresh_rejects_garbage(
    client: AsyncClient,
) -> None:
    response = await client.post("/auth/jwt/refresh", json={"refresh_token": "not-a-jwt"})
    assert response.status_code == 401
