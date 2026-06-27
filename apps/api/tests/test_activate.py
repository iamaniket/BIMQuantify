"""Tests for POST /auth/activate — single-call invite activation.

The legacy two-step flow (frontend called /auth/verify then /auth/reset-password
with the same token) was broken: the verify token's audience is
"fastapi-users:verify" but /auth/reset-password decodes with audience
"fastapi-users:reset", so the reset call always failed with a misleading
"link expired" error. /auth/activate accepts the verify token and atomically
flips is_verified + sets the password.
"""

import re
from datetime import datetime, timezone
from uuid import uuid4

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.email.transport import InMemoryEmailTransport
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User
from tests.conftest import make_test_user

NEW_PASSWORD = "fresh-horse-staple-67"


def _extract_token(body: str) -> str:
    match = re.search(r"Token:\s*(\S+)", body)
    assert match is not None, f"no token in email body: {body!r}"
    return match.group(1)


async def _request_verify_token(
    client: AsyncClient, email: str, transport: InMemoryEmailTransport
) -> str:
    response = await client.post("/auth/request-verify-token", json={"email": email})
    assert response.status_code in (200, 202), response.text
    sent = transport.last_for(email)
    assert sent is not None, f"no verify email sent to {email}"
    return _extract_token(sent.body)


async def test_activate_success_verifies_and_sets_password(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """Happy path: fresh invite → user verified + password set + login works."""
    # Use a test-unique email — `alice@example.com` and other common test
    # names are reused by `org_user`/`same_org_user` fixtures in conftest.
    email = "activate-success@example.com"
    await make_test_user(session_maker, email=email, is_verified=False)
    token = await _request_verify_token(client, email, email_transport)

    response = await client.post(
        "/auth/activate", json={"token": token, "password": NEW_PASSWORD}
    )
    assert response.status_code == 204, response.text

    async with session_maker() as session:
        user = (
            await session.execute(select(User).where(User.email == email))
        ).scalar_one()
        assert user.is_verified is True

    login = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": NEW_PASSWORD},
    )
    assert login.status_code == 200, login.text


async def test_activate_flips_sole_pending_membership(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """Bootstrap auto-accept (auth/manager.py:68-107) fires through activate.

    A freshly-activated user with no active memberships and exactly one
    pending invite should land with that invite flipped to active — they
    were created BECAUSE of that invite, so nothing for them to choose.
    """
    email = "activate-pending@example.com"
    user_id = await make_test_user(session_maker, email=email, is_verified=False)
    org_id = uuid4()
    async with session_maker() as session:
        session.add(
            Organization(
                id=org_id,
                name="Invite Org",
                schema_name=f"org_{str(org_id).replace('-', '_')}",
                status=OrganizationStatus.active,
                provisioned_at=datetime.now(timezone.utc),
            )
        )
        session.add(
            OrganizationMember(
                user_id=user_id,
                organization_id=org_id,
                is_org_admin=False,
                status=OrganizationMemberStatus.pending,
                invited_at=datetime.now(timezone.utc),
            )
        )
        await session.commit()

    token = await _request_verify_token(client, email, email_transport)
    response = await client.post(
        "/auth/activate", json={"token": token, "password": NEW_PASSWORD}
    )
    assert response.status_code == 204, response.text

    async with session_maker() as session:
        member = (
            await session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == user_id,
                    OrganizationMember.organization_id == org_id,
                )
            )
        ).scalar_one()
        assert member.status == OrganizationMemberStatus.active
        assert member.accepted_at is not None


async def test_activate_rejects_bad_token(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/activate", json={"token": "not-a-real-token", "password": NEW_PASSWORD}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "ACTIVATION_BAD_TOKEN"


async def test_activate_rejects_reset_password_token(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """Audience guard: a /auth/forgot-password token must NOT activate.

    Reset-password tokens have aud=fastapi-users:reset; the activate endpoint
    decodes with aud=fastapi-users:verify, so jwt.decode rejects them. This
    is the exact misuse the legacy frontend made — pinned in a test so the
    audiences can never be silently merged.
    """
    email = "activate-wrong-audience@example.com"
    await make_test_user(session_maker, email=email, is_verified=True)

    forgot = await client.post("/auth/forgot-password", json={"email": email})
    assert forgot.status_code in (200, 202), forgot.text
    sent = email_transport.last_for(email)
    assert sent is not None
    reset_token = _extract_token(sent.body)

    response = await client.post(
        "/auth/activate", json={"token": reset_token, "password": NEW_PASSWORD}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "ACTIVATION_BAD_TOKEN"


async def test_activate_replay_is_noop_password_unchanged(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """Replay click: the activation token sets the password EXACTLY ONCE.

    The first call verifies the user and sets the password. A replay (same
    token, already-verified user) is an idempotent no-op — it returns 204 so a
    double-click/prefetch never errors, but it MUST NOT reset the password.
    This closes the account-takeover window where anyone observing the one-time
    invite link could POST a new password to a live account (F1). The first
    password keeps working; a replayed second password is ignored.
    """
    email = "activate-replay@example.com"
    first_password = "first-password-abc"
    await make_test_user(session_maker, email=email, is_verified=False)
    token = await _request_verify_token(client, email, email_transport)

    first = await client.post(
        "/auth/activate", json={"token": token, "password": first_password}
    )
    assert first.status_code == 204, first.text

    # Replay with a DIFFERENT password — succeeds (idempotent) but is a no-op.
    second = await client.post(
        "/auth/activate", json={"token": token, "password": NEW_PASSWORD}
    )
    assert second.status_code == 204, second.text

    # The replayed password must NOT have taken effect.
    rejected = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": NEW_PASSWORD},
    )
    assert rejected.status_code == 400, rejected.text

    # The original (first) password still works.
    login = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": first_password},
    )
    assert login.status_code == 200, login.text


async def test_activate_inactive_user_rejected(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """is_active=False must short-circuit the flow, even with a valid token."""
    email = "activate-inactive@example.com"
    await make_test_user(session_maker, email=email, is_verified=False)
    token = await _request_verify_token(client, email, email_transport)

    # Flip the user to inactive AFTER the verify token is in flight.
    async with session_maker() as session:
        user = (
            await session.execute(select(User).where(User.email == email))
        ).scalar_one()
        user.is_active = False
        await session.commit()

    response = await client.post(
        "/auth/activate", json={"token": token, "password": NEW_PASSWORD}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "ACTIVATION_USER_INACTIVE"


async def test_activate_rejects_short_password(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """SOC2 CC6.1: a password below the minimum length is rejected.

    The check runs BEFORE is_verified flips, so a rejected password must leave
    the account unverified (never verified-but-passwordless).
    """
    email = "activate-shortpw@example.com"
    await make_test_user(session_maker, email=email, is_verified=False)
    token = await _request_verify_token(client, email, email_transport)

    response = await client.post(
        "/auth/activate", json={"token": token, "password": "short"}
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "ACTIVATION_INVALID_PASSWORD"

    async with session_maker() as session:
        user = (
            await session.execute(select(User).where(User.email == email))
        ).scalar_one()
        assert user.is_verified is False  # rejected before the verify flip


async def test_activate_rejects_password_containing_email(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """SOC2 CC6.1: a long-but-weak password embedding the email local-part is
    rejected even though it clears the length floor."""
    email = "activate-emailpw@example.com"
    await make_test_user(session_maker, email=email, is_verified=False)
    token = await _request_verify_token(client, email, email_transport)

    # Local-part "activate-emailpw" is embedded; 20 chars clears the length floor.
    response = await client.post(
        "/auth/activate",
        json={"token": token, "password": "activate-emailpw-99x"},
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "ACTIVATION_INVALID_PASSWORD"
