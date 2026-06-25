"""Super-admin impersonation endpoint.

Covers minting, the access-only contract, target restrictions (active,
verified, non-superuser, not self, must be member of explicit org),
TTL clamping, audit attribution (both the start event and subsequent
mutations carry `impersonator_user_id`), and the refresh-rejection path.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi_users.password import PasswordHelper
from httpx import AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.auth.tokens import ALGORITHM, REFRESH_AUDIENCE, decode_token_full
from bimdossier_api.config import get_settings
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.user import User
from bimdossier_api.tenancy import schema_name_for
from tests.conftest import _audit_rows

PASSWORD = "correct-horse-battery"
REASON = "reproducing a customer support ticket"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    resp = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _make_user(
    session: AsyncSession,
    email: str,
    *,
    is_superuser: bool = False,
    is_verified: bool = True,
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name=email.split("@")[0],
        is_active=is_active,
        is_verified=is_verified,
        is_superuser=is_superuser,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_org(session: AsyncSession, name: str) -> Organization:
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=name,
        schema_name=schema_name_for(org_id),
        status=OrganizationStatus.active,
        provisioned_at=datetime.now(UTC),
    )
    session.add(org)
    await session.commit()
    await session.refresh(org)
    return org


@pytest.fixture
async def superadmin(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    user = await _make_user(session, "root@example.com", is_superuser=True)
    tokens = await _login(client, user.email)
    return {"token": tokens["access_token"], "user_id": str(user.id)}


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


async def test_super_admin_impersonates_regular_user(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com")

    resp = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": REASON},
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0
    assert body["impersonated_user"]["id"] == str(target.id)
    assert body["impersonated_user"]["email"] == target.email

    decoded = decode_token_full(body["access_token"], "access")
    assert decoded.user_id == target.id
    assert decoded.impersonator_user_id is not None
    assert str(decoded.impersonator_user_id) == superadmin["user_id"]


async def test_impersonation_token_authenticates_as_target(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com")
    resp = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": REASON},
        headers=_auth(superadmin["token"]),
    )
    imp_token = resp.json()["access_token"]

    me = await client.get("/users/me", headers=_auth(imp_token))
    assert me.status_code == 200, me.text
    assert me.json()["email"] == target.email


# ---------------------------------------------------------------------------
# Target restrictions
# ---------------------------------------------------------------------------


async def test_cannot_impersonate_super_admin(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    other_super = await _make_user(
        session, "other-super@example.com", is_superuser=True
    )
    resp = await client.post(
        f"/admin/impersonate/{other_super.id}",
        json={"reason": REASON},
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "CANNOT_IMPERSONATE_SUPERUSER"


async def test_cannot_impersonate_self(
    client: AsyncClient,
    superadmin: dict[str, str],
) -> None:
    resp = await client.post(
        f"/admin/impersonate/{superadmin['user_id']}",
        json={"reason": REASON},
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "CANNOT_IMPERSONATE_SELF"


async def test_cannot_impersonate_inactive_user(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com", is_active=False)
    resp = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": REASON},
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "CANNOT_IMPERSONATE_INACTIVE"


async def test_cannot_impersonate_unverified_user(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com", is_verified=False)
    resp = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": REASON},
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "CANNOT_IMPERSONATE_UNVERIFIED"


async def test_target_not_in_specified_org(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com")
    other_org = await _make_org(session, "OtherCo")

    resp = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": REASON, "organization_id": str(other_org.id)},
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "TARGET_NOT_IN_ORG"


# ---------------------------------------------------------------------------
# Non-superuser callers cannot impersonate
# ---------------------------------------------------------------------------


async def test_non_super_admin_cannot_impersonate(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    regular = await _make_user(session, "regular@example.com")
    target = await _make_user(session, "alice@example.com")
    tokens = await _login(client, regular.email)

    resp = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": REASON},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "SUPERUSER_REQUIRED"


# ---------------------------------------------------------------------------
# TTL clamping
# ---------------------------------------------------------------------------


async def test_ttl_request_above_ceiling_is_clamped(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com")
    settings = get_settings()
    ceiling = settings.impersonation_token_ttl_seconds

    resp = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": REASON, "ttl_seconds": ceiling * 10},
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["expires_in"] <= ceiling
    # Sanity: at least 60s below the upper bound (we're not picking 0).
    assert body["expires_in"] > 60


async def test_ttl_request_below_floor_is_rejected(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com")
    resp = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": REASON, "ttl_seconds": 30},  # < 60 floor
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# Refresh rejection — a refresh token with `imp` is refused
# ---------------------------------------------------------------------------


async def test_refresh_with_imp_claim_is_rejected(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    """`create_token` won't mint a refresh with `imp` (raises ValueError),
    but a hand-crafted token must be rejected by the refresh endpoint.
    """
    settings = get_settings()
    target_id = uuid4()
    superadmin_id = uuid4()
    now = int(datetime.now(UTC).timestamp())
    payload = {
        "sub": str(target_id),
        "aud": REFRESH_AUDIENCE,
        "typ": "refresh",
        "jti": uuid4().hex,
        "iat": now,
        "exp": now + 60,
        "imp": str(superadmin_id),
    }
    forged = jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)

    resp = await client.post(
        "/auth/jwt/refresh",
        json={"refresh_token": forged},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "IMPERSONATION_REFRESH_FORBIDDEN"


# ---------------------------------------------------------------------------
# Audit attribution
# ---------------------------------------------------------------------------


async def test_audit_records_impersonate_start_event(
    client: AsyncClient,
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com")
    resp = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": REASON},
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 200
    imp_token = resp.json()["access_token"]
    decoded = decode_token_full(imp_token, "access")
    minted_jti = decoded.jti

    # No org resolved for this impersonation → entry lands in the platform schema.
    rows = await _audit_rows(session_maker, "auth.impersonate.start")
    assert len(rows) == 1
    row = rows[0]
    assert str(row.user_id) == superadmin["user_id"]
    assert str(row.impersonator_user_id) == superadmin["user_id"]
    assert row.resource_id == str(target.id)
    assert row.after is not None
    assert row.after["target_email"] == target.email
    assert row.after["jti"] == minted_jti
    assert row.after["reason"] == REASON


async def test_mutations_during_impersonation_record_impersonator(
    client: AsyncClient,
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
    superadmin: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    """Impersonate the org admin and make a member-mutating call. The
    resulting audit row should attribute the action to the impersonated
    user (`user_id`) AND record the super admin in `impersonator_user_id`.
    """
    # `org_user` is an org admin. Impersonate them so the role-change call
    # below is authorized.
    impersonate = await client.post(
        f"/admin/impersonate/{org_user['id']}",
        json={"reason": REASON, "organization_id": org_user["organization_id"]},
        headers=_auth(superadmin["token"]),
    )
    assert impersonate.status_code == 200, impersonate.text
    imp_token = impersonate.json()["access_token"]

    # Trigger an audited mutation: change another member's status.
    org_id = org_user["organization_id"]
    same_user_id = same_org_user["id"]
    resp = await client.patch(
        f"/organizations/{org_id}/members/{same_user_id}",
        json={"status": "suspended"},
        headers=_auth(imp_token),
    )
    assert resp.status_code == 200, resp.text

    rows = await _audit_rows(session_maker, "organization_member.status_changed")
    assert rows, "expected at least one status_changed audit row"
    row = rows[0]
    # Actor is the impersonated user.
    assert str(row.user_id) == org_user["id"]
    # And the impersonator column points at the super admin.
    assert str(row.impersonator_user_id) == superadmin["user_id"]


# ---------------------------------------------------------------------------
# Mandatory reason
# ---------------------------------------------------------------------------


async def test_impersonate_requires_reason(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com")
    resp = await client.post(
        f"/admin/impersonate/{target.id}",
        json={},  # reason omitted
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 422, resp.text


async def test_impersonate_rejects_blank_reason(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com")
    resp = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": "   "},  # whitespace-only — must be rejected
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# Stop impersonation
# ---------------------------------------------------------------------------


async def test_stop_impersonation_revokes_token(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com")
    start = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": REASON},
        headers=_auth(superadmin["token"]),
    )
    assert start.status_code == 200, start.text
    imp_token = start.json()["access_token"]

    # The impersonation token works before stopping.
    me = await client.get("/users/me", headers=_auth(imp_token))
    assert me.status_code == 200, me.text

    stop = await client.post("/admin/impersonate/stop", headers=_auth(imp_token))
    assert stop.status_code == 200, stop.text
    body = stop.json()
    assert body["stopped"] is True
    assert body["impersonated_user_id"] == str(target.id)
    assert body["impersonator_user_id"] == superadmin["user_id"]

    # And is dead immediately afterwards — no waiting for TTL expiry.
    me_after = await client.get("/users/me", headers=_auth(imp_token))
    assert me_after.status_code == 401


async def test_stop_rejects_non_impersonation_token(
    client: AsyncClient,
    superadmin: dict[str, str],
) -> None:
    # The super admin's own token carries no `imp` claim — nothing to stop.
    resp = await client.post(
        "/admin/impersonate/stop", headers=_auth(superadmin["token"])
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "NOT_AN_IMPERSONATION_SESSION"


async def test_stop_without_bearer_is_rejected(client: AsyncClient) -> None:
    resp = await client.post("/admin/impersonate/stop")
    assert resp.status_code == 401


async def test_stop_records_audit_event(
    client: AsyncClient,
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
    superadmin: dict[str, str],
) -> None:
    target = await _make_user(session, "alice@example.com")
    start = await client.post(
        f"/admin/impersonate/{target.id}",
        json={"reason": REASON},
        headers=_auth(superadmin["token"]),
    )
    assert start.status_code == 200, start.text
    imp_token = start.json()["access_token"]
    minted_jti = decode_token_full(imp_token, "access").jti

    stop = await client.post("/admin/impersonate/stop", headers=_auth(imp_token))
    assert stop.status_code == 200, stop.text

    rows = await _audit_rows(session_maker, "auth.impersonate.stop")
    assert len(rows) == 1
    row = rows[0]
    # Both the actor and the impersonator column point at the super admin who
    # ran the session — symmetric with the start event.
    assert str(row.user_id) == superadmin["user_id"]
    assert str(row.impersonator_user_id) == superadmin["user_id"]
    assert row.resource_id == str(target.id)
    assert row.after is not None
    assert row.after["jti"] == minted_jti
