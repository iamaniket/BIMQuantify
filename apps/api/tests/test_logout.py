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


async def test_logout_revokes_access_token(
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    tokens = await _login(client, email_transport, "lara@example.com")
    auth = {"Authorization": f"Bearer {tokens['access_token']}"}

    me = await client.get("/users/me", headers=auth)
    assert me.status_code == 200, me.text

    logout = await client.post("/auth/logout", headers=auth, json={})
    assert logout.status_code == 204

    me_after = await client.get("/users/me", headers=auth)
    assert me_after.status_code == 401


async def test_logout_revokes_refresh_token_when_provided(
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    tokens = await _login(client, email_transport, "leo@example.com")
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
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    tokens = await _login(client, email_transport, "lily@example.com")

    refresh = await client.post(
        "/auth/jwt/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert refresh.status_code == 200, refresh.text
