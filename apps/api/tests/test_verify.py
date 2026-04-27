import re

from httpx import AsyncClient

from bimstitch_api.email.transport import InMemoryEmailTransport


def _extract_token(body: str) -> str:
    match = re.search(r"Token:\s*(\S+)", body)
    assert match is not None, f"no token in email body: {body!r}"
    return match.group(1)


async def test_verify_flips_is_verified(
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    email = "eve@example.com"
    await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "hunter2hunter2",
            "full_name": "Eve",
            "organization_name": "Acme",
        },
    )
    sent = email_transport.last_for(email)
    assert sent is not None
    token = _extract_token(sent.body)

    verify = await client.post("/auth/verify", json={"token": token})
    assert verify.status_code == 200, verify.text
    assert verify.json()["is_verified"] is True


async def test_verify_rejects_bad_token(
    client: AsyncClient, email_transport: InMemoryEmailTransport
) -> None:
    response = await client.post("/auth/verify", json={"token": "not-a-real-token"})
    assert response.status_code == 400
