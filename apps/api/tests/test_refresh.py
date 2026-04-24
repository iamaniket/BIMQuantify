import re

from httpx import AsyncClient

from bimquantify_api.email.transport import InMemoryEmailTransport


async def _login(
    client: AsyncClient, email_transport: InMemoryEmailTransport, email: str
) -> dict[str, str]:
    await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "correct-horse-battery",
            "full_name": "T",
            "organization_name": "O",
        },
    )
    sent = email_transport.last_for(email)
    assert sent is not None
    token = re.search(r"Token:\s*(\S+)", sent.body).group(1)  # type: ignore[union-attr]
    await client.post("/auth/verify", json={"token": token})
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": "correct-horse-battery"},
    )
    return response.json()


async def test_refresh_issues_new_access_token(
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    tokens = await _login(client, email_transport, "ivy@example.com")
    response = await client.post(
        "/auth/jwt/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["access_token"]
    assert body["access_token"] != tokens["access_token"] or body["token_type"] == "bearer"


async def test_refresh_rejects_access_token(
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    tokens = await _login(client, email_transport, "jane@example.com")
    response = await client.post(
        "/auth/jwt/refresh", json={"refresh_token": tokens["access_token"]}
    )
    assert response.status_code == 401


async def test_refresh_rejects_garbage(
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    response = await client.post("/auth/jwt/refresh", json={"refresh_token": "not-a-jwt"})
    assert response.status_code == 401
