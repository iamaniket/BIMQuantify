import re

from httpx import AsyncClient

from bimquantify_api.email.transport import InMemoryEmailTransport


async def _register(client: AsyncClient, email: str) -> None:
    await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "correct-horse-battery",
            "full_name": "Test User",
            "organization_name": "Org",
        },
    )


async def _verify(client: AsyncClient, email_transport: InMemoryEmailTransport, email: str) -> None:
    sent = email_transport.last_for(email)
    assert sent is not None
    match = re.search(r"Token:\s*(\S+)", sent.body)
    assert match is not None
    await client.post("/auth/verify", json={"token": match.group(1)})


async def test_login_unverified_is_rejected(
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    email = "frank@example.com"
    await _register(client, email)
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": "correct-horse-battery"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "LOGIN_USER_NOT_VERIFIED"


async def test_login_returns_access_and_refresh(
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    email = "grace@example.com"
    await _register(client, email)
    await _verify(client, email_transport, email)

    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": "correct-horse-battery"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["access_token"] != body["refresh_token"]


async def test_login_bad_password(
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    email = "hank@example.com"
    await _register(client, email)
    await _verify(client, email_transport, email)
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": "wrong-password-zzz"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "LOGIN_BAD_CREDENTIALS"
