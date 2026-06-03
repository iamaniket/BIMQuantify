"""Tests for admin access-request endpoints — list, approve, reject, export."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import pytest
from fastapi_users.password import PasswordHelper
from sqlalchemy import select

from bimstitch_api.models.access_request import AccessRequest, AccessRequestStatus
from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimstitch_api.models.user import User
from bimstitch_api.tenancy import schema_name_for

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession

    from bimstitch_api.email.transport import InMemoryEmailTransport


PASSWORD = "correct-horse-battery"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


async def _make_superuser(session: AsyncSession, email: str) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name="Root Admin",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_regular_user(session: AsyncSession, email: str) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name="Regular User",
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _seed_access_request(
    session: AsyncSession,
    *,
    work_email: str = "lieke@heijmans.nl",
    company: str = "Heijmans Bouw N.V.",
    status: AccessRequestStatus = AccessRequestStatus.new,
) -> AccessRequest:
    ar = AccessRequest(
        name="Lieke Beumer",
        work_email=work_email,
        company=company,
        role="BIM Manager",
        company_size="201-500",
        country="NL",
        notes="Interested in Wkb workflow.",
        status=status,
    )
    session.add(ar)
    await session.commit()
    await session.refresh(ar)
    return ar


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_requires_superuser(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_regular_user(session, "user@test.nl")
    token = await _login(client, "user@test.nl")
    response = await client.get("/admin/access-requests", headers=_auth(token))
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_access_requests(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    await _seed_access_request(session)
    token = await _login(client, "admin@test.nl")

    response = await client.get("/admin/access-requests", headers=_auth(token))
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["work_email"] == "lieke@heijmans.nl"
    assert data[0]["status"] == "new"
    assert "updated_at" in data[0]


@pytest.mark.asyncio
async def test_list_filter_by_status(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    await _seed_access_request(session, work_email="a@x.nl", status=AccessRequestStatus.new)
    await _seed_access_request(session, work_email="b@x.nl", status=AccessRequestStatus.rejected)
    token = await _login(client, "admin@test.nl")

    response = await client.get(
        "/admin/access-requests", params={"status": "new"}, headers=_auth(token),
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["work_email"] == "a@x.nl"


@pytest.mark.asyncio
async def test_list_search(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    await _seed_access_request(session, work_email="a@heijmans.nl", company="Heijmans")
    await _seed_access_request(session, work_email="b@bam.nl", company="BAM Bouw")
    token = await _login(client, "admin@test.nl")

    response = await client.get(
        "/admin/access-requests", params={"q": "bam"}, headers=_auth(token),
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["company"] == "BAM Bouw"


# ---------------------------------------------------------------------------
# Reject
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reject_access_request(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    ar = await _seed_access_request(session)
    token = await _login(client, "admin@test.nl")

    response = await client.post(
        f"/admin/access-requests/{ar.id}/reject", headers=_auth(token),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"


@pytest.mark.asyncio
async def test_reject_already_rejected(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    ar = await _seed_access_request(session, status=AccessRequestStatus.rejected)
    token = await _login(client, "admin@test.nl")

    response = await client.post(
        f"/admin/access-requests/{ar.id}/reject", headers=_auth(token),
    )
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_csv(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    await _make_superuser(session, "admin@test.nl")
    await _seed_access_request(session)
    token = await _login(client, "admin@test.nl")

    response = await client.get("/admin/access-requests/export", headers=_auth(token))
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    lines = response.text.strip().split("\n")
    assert len(lines) == 2  # header + 1 data row
    assert "work_email" in lines[0]
    assert "lieke@heijmans.nl" in lines[1]


# ---------------------------------------------------------------------------
# Approve — provisions org + dispatches activation email
# ---------------------------------------------------------------------------


@pytest.fixture
def stub_provisioning(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace `provision_organization` with a DB-only stub.

    Mirrors the fixture in `test_invitations.py` — skips schema creation /
    alembic / grants so the approve test can hit the route without setting
    up real per-tenant schemas.
    """
    from bimstitch_api.admin import provisioning as prov_module
    from bimstitch_api.db import get_session_maker
    from bimstitch_api.routers import admin_organizations as router_module

    async def _fake_provision(
        *,
        name: str,
        admin_email: str,
        admin_full_name: str | None,
        seat_limit: int | None = None,
        requester: User,
        request: Any = None,
    ) -> prov_module.ProvisionResult:
        from sqlalchemy import func

        org_id = uuid4()
        schema = schema_name_for(org_id)
        sm = get_session_maker()
        async with sm() as s:
            async with s.begin():
                org = Organization(
                    id=org_id,
                    name=name,
                    schema_name=schema,
                    status=OrganizationStatus.active,
                    provisioned_at=datetime.now(UTC),
                    seat_limit=seat_limit,
                )
                s.add(org)

                existing = (
                    await s.execute(
                        select(User).where(func.lower(User.email) == admin_email.lower())
                    )
                ).scalar_one_or_none()
                created_admin = existing is None
                if existing is None:
                    import secrets

                    user = User(
                        email=admin_email,
                        hashed_password=PasswordHelper().hash(secrets.token_hex(32)),
                        full_name=admin_full_name,
                        is_active=True,
                        is_verified=False,
                        is_superuser=False,
                    )
                    s.add(user)
                    await s.flush()
                else:
                    user = existing
                activation_required = not user.is_verified

                s.add(
                    OrganizationMember(
                        user_id=user.id,
                        organization_id=org_id,
                        is_org_admin=True,
                        status=OrganizationMemberStatus.pending,
                        invited_by=requester.id,
                    )
                )

            org_refreshed = await s.get(Organization, org_id)
            user_refreshed = await s.get(User, user.id)
            assert org_refreshed is not None and user_refreshed is not None

        return prov_module.ProvisionResult(
            organization=org_refreshed,
            admin=user_refreshed,
            created_admin=created_admin,
            activation_required=activation_required,
        )

    monkeypatch.setattr(router_module, "provision_organization", _fake_provision)


@pytest.mark.asyncio
async def test_approve_provisions_org_and_sends_activation_email(
    client: AsyncClient,
    session: AsyncSession,
    email_transport: InMemoryEmailTransport,
    stub_provisioning: None,
) -> None:
    """Happy path: approve creates a new org for the requester, sends the
    activation email, and flips the AR status to approved."""
    await _make_superuser(session, "admin@test.nl")
    ar = await _seed_access_request(session)
    token = await _login(client, "admin@test.nl")

    response = await client.post(
        f"/admin/access-requests/{ar.id}/approve",
        headers=_auth(token),
        json={"org_name": "Heijmans BV", "seat_limit": 25},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    # Response shape
    assert body["access_request"]["status"] == "approved"
    assert body["access_request"]["work_email"] == "lieke@heijmans.nl"
    assert body["organization"]["name"] == "Heijmans BV"
    assert body["organization"]["seat_limit"] == 25
    assert body["admin_email"] == "lieke@heijmans.nl"
    assert body["activation_required"] is True

    # Activation email reached the requester with a token line
    sent = email_transport.last_for("lieke@heijmans.nl")
    assert sent is not None, "activation email should have been dispatched"
    assert re.search(r"Token:\s*\S+", sent.body), f"no token in email body: {sent.body!r}"

    # AR row reflects approved
    await session.refresh(ar)
    assert ar.status == AccessRequestStatus.approved


@pytest.mark.asyncio
async def test_approve_falls_back_to_company_when_org_name_omitted(
    client: AsyncClient,
    session: AsyncSession,
    email_transport: InMemoryEmailTransport,
    stub_provisioning: None,
) -> None:
    """Omitting org_name in the body uses the requester's company name."""
    await _make_superuser(session, "admin@test.nl")
    ar = await _seed_access_request(session, company="DefaultCo BV")
    token = await _login(client, "admin@test.nl")

    response = await client.post(
        f"/admin/access-requests/{ar.id}/approve",
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    assert response.json()["organization"]["name"] == "DefaultCo BV"


@pytest.mark.asyncio
async def test_approve_already_approved_returns_409(
    client: AsyncClient,
    session: AsyncSession,
    stub_provisioning: None,
) -> None:
    """Once approved, calling approve again is a 409 — the saga is not retried
    and no second org gets created."""
    await _make_superuser(session, "admin@test.nl")
    ar = await _seed_access_request(session, status=AccessRequestStatus.approved)
    token = await _login(client, "admin@test.nl")

    response = await client.post(
        f"/admin/access-requests/{ar.id}/approve",
        headers=_auth(token),
        json={"org_name": "Whatever"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "ACCESS_REQUEST_NOT_PENDING"


@pytest.mark.asyncio
async def test_approve_returns_409_when_org_name_taken(
    client: AsyncClient,
    session: AsyncSession,
    stub_provisioning: None,
) -> None:
    """If an organization with the requested name already exists, the approve
    endpoint must return 409 ORG_NAME_TAKEN BEFORE entering the saga, and the
    AR row must stay `new` so the admin can retry with a different name."""
    from datetime import UTC, datetime
    from uuid import uuid4

    # Seed an existing org with a colliding name.
    existing_org_id = uuid4()
    existing = Organization(
        id=existing_org_id,
        name="Heijmans BV",
        schema_name=f"org_{existing_org_id.hex}",
        status=OrganizationStatus.active,
        provisioned_at=datetime.now(UTC),
    )
    session.add(existing)
    await session.commit()

    await _make_superuser(session, "admin@test.nl")
    ar = await _seed_access_request(session)
    token = await _login(client, "admin@test.nl")

    response = await client.post(
        f"/admin/access-requests/{ar.id}/approve",
        headers=_auth(token),
        json={"org_name": "Heijmans BV"},
    )
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "ORG_NAME_TAKEN"
    assert detail["existing_org_id"] == str(existing_org_id)

    # AR row must NOT have been flipped to approved — admin retries.
    await session.refresh(ar)
    assert ar.status == AccessRequestStatus.new


@pytest.mark.asyncio
async def test_approve_returns_409_when_org_name_taken_case_insensitive(
    client: AsyncClient,
    session: AsyncSession,
    stub_provisioning: None,
) -> None:
    """The collision check is case-insensitive — 'heijmans bv' collides with
    'Heijmans BV'."""
    from datetime import UTC, datetime
    from uuid import uuid4

    existing_org_id = uuid4()
    session.add(
        Organization(
            id=existing_org_id,
            name="Heijmans BV",
            schema_name=f"org_{existing_org_id.hex}",
            status=OrganizationStatus.active,
            provisioned_at=datetime.now(UTC),
        )
    )
    await session.commit()

    await _make_superuser(session, "admin@test.nl")
    ar = await _seed_access_request(session)
    token = await _login(client, "admin@test.nl")

    response = await client.post(
        f"/admin/access-requests/{ar.id}/approve",
        headers=_auth(token),
        json={"org_name": "heijmans bv"},
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_approve_existing_verified_user_skips_activation_email(
    client: AsyncClient,
    session: AsyncSession,
    email_transport: InMemoryEmailTransport,
    stub_provisioning: None,
) -> None:
    """If the requester's email already belongs to a verified user, the saga
    reuses them and the route sends an invite notification instead of an
    activation token email."""
    # Pre-existing verified user with the same email as the access request
    existing = User(
        email="lieke@heijmans.nl",
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name="Existing User",
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    session.add(existing)
    await session.commit()

    await _make_superuser(session, "admin@test.nl")
    ar = await _seed_access_request(session)
    token = await _login(client, "admin@test.nl")

    response = await client.post(
        f"/admin/access-requests/{ar.id}/approve",
        headers=_auth(token),
        json={"org_name": "Heijmans BV"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["activation_required"] is False

    # Notification email, not activation — no token line
    sent = email_transport.last_for("lieke@heijmans.nl")
    assert sent is not None
    assert "Token:" not in sent.body


@pytest.mark.asyncio
async def test_approve_marks_ar_approved_when_email_dispatch_raises(
    client: AsyncClient,
    session: AsyncSession,
    stub_provisioning: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Email dispatch is best-effort: if SMTP / FastAPI Users state / anything
    after the saga raises, the AR row MUST still be flipped to `approved`.

    Regression guard for the half-completion bug where a thrown email left the
    saga's org+user+member committed but AR stranded at `new` — the admin then
    hit ORG_NAME_TAKEN on retry. See admin_organizations._dispatch_invite_email.
    """
    from bimstitch_api.email.transport import (
        InMemoryEmailTransport,
        set_email_transport,
    )

    class _BrokenTransport(InMemoryEmailTransport):
        async def send(self, to: str, subject: str, body: str) -> None:
            raise RuntimeError("simulated SMTP outage")

    broken = _BrokenTransport()
    set_email_transport(broken)
    try:
        await _make_superuser(session, "admin@test.nl")
        ar = await _seed_access_request(session)
        token = await _login(client, "admin@test.nl")

        response = await client.post(
            f"/admin/access-requests/{ar.id}/approve",
            headers=_auth(token),
            json={"org_name": "Heijmans BV"},
        )
    finally:
        # Restore so other tests' email_transport fixture starts clean.
        set_email_transport(InMemoryEmailTransport())

    # Route returns 200 — the org is real, AR is approved. Admin retries the
    # email via /resend-invite, not by re-approving.
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["access_request"]["status"] == "approved"
    assert body["organization"]["name"] == "Heijmans BV"

    # Most important assertion: AR is approved in the DB even though the email
    # transport raised. This is what was broken before the reorder.
    await session.refresh(ar)
    assert ar.status == AccessRequestStatus.approved

    # The broken transport never recorded the email — confirms the exception
    # actually fired in the dispatch path.
    assert broken.sent == []
