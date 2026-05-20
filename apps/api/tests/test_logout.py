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


async def test_logout_revokes_access_token(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    tokens = await _login(client, session_maker, "lara@example.com")
    auth = {"Authorization": f"Bearer {tokens['access_token']}"}

    me = await client.get("/users/me", headers=auth)
    assert me.status_code == 200, me.text

    logout = await client.post("/auth/logout", headers=auth, json={})
    assert logout.status_code == 204

    me_after = await client.get("/users/me", headers=auth)
    assert me_after.status_code == 401


async def test_logout_revokes_refresh_token_when_provided(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    tokens = await _login(client, session_maker, "leo@example.com")
    auth = {"Authorization": f"Bearer {tokens['access_token']}"}

    logout = await client.post(
        "/auth/logout",
        headers=auth,
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert logout.status_code == 204

    refresh = await client.post(
        "/auth/jwt/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert refresh.status_code == 401
    assert "revoked" in refresh.json()["detail"].lower()


async def test_logout_without_bearer_is_rejected(client: AsyncClient) -> None:
    response = await client.post("/auth/logout", json={})
    assert response.status_code == 401


async def test_refresh_still_works_for_unrevoked_tokens(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    tokens = await _login(client, session_maker, "lily@example.com")

    refresh = await client.post(
        "/auth/jwt/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert refresh.status_code == 200, refresh.text
