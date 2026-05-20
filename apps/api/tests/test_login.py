from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.conftest import _TEST_PASSWORD, make_test_user


async def test_login_unverified_is_rejected(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    email = "frank@example.com"
    await make_test_user(session_maker, email=email, is_verified=False)
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": _TEST_PASSWORD},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "LOGIN_USER_NOT_VERIFIED"


async def test_login_returns_access_and_refresh(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    email = "grace@example.com"
    await make_test_user(session_maker, email=email)

    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": _TEST_PASSWORD},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["access_token"] != body["refresh_token"]


async def test_login_bad_password(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    email = "hank@example.com"
    await make_test_user(session_maker, email=email)
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": "wrong-password-zzz"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "LOGIN_BAD_CREDENTIALS"
