import re

from httpx import AsyncClient

from bimstitch_api.email.transport import InMemoryEmailTransport


async def _login(
    client: AsyncClient, email_transport: InMemoryEmailTransport, email: str
) -> dict[str, str]:
    await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "correct-horse-battery",
            "full_name": "Me",
            "organization_name": "MyOrg",
        },
    )
    sent = email_transport.last_for(email)
    assert sent is not None
    token = re.search(r"Token:\s*(\S+)", sent.body).group(1)  # type: ignore[union-attr]
    await client.post("/auth/verify", json={"token": token})
    return (
        await client.post(
            "/auth/jwt/login",
            data={"username": email, "password": "correct-horse-battery"},
        )
    ).json()


async def test_me_returns_current_user(
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    tokens = await _login(client, email_transport, "ken@example.com")
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
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    tokens = await _login(client, email_transport, "lee@example.com")
    response = await client.get(
        "/users/me",
        headers={"Authorization": f"Bearer {tokens['refresh_token']}"},
    )
    assert response.status_code == 401
