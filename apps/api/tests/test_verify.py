import re

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.email.transport import InMemoryEmailTransport
from tests.conftest import make_test_user


def _extract_token(body: str) -> str:
    match = re.search(r"Token:\s*(\S+)", body)
    assert match is not None, f"no token in email body: {body!r}"
    return match.group(1)


async def test_verify_flips_is_verified(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """Activation flow: create the user as unverified (mimicking the admin
    invite path), request a verification token, POST it to /auth/verify,
    and confirm the user becomes verified."""
    email = "eve@example.com"
    await make_test_user(session_maker, email=email, is_verified=False)

    # Trigger the activation email by asking FastAPI Users to send one. The
    # public `/auth/register` route is gone, so we drive `request-verify-token`
    # directly — the admin invite flow uses the same underlying mechanism.
    req = await client.post("/auth/request-verify-token", json={"email": email})
    assert req.status_code in (200, 202), req.text

    sent = email_transport.last_for(email)
    assert sent is not None
    token = _extract_token(sent.body)

    verify = await client.post("/auth/verify", json={"token": token})
    assert verify.status_code == 200, verify.text
    assert verify.json()["is_verified"] is True


async def test_verify_rejects_bad_token(client: AsyncClient) -> None:
    response = await client.post("/auth/verify", json={"token": "not-a-real-token"})
    assert response.status_code == 400
