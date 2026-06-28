"""Tests for the explicit-accept invitation flow.

Covers:
  * `POST /admin/organizations` now sends the activation email when the
    admin is brand new (previously silently broken — the saga set
    `activation_required=True` but no email was ever dispatched).
  * `POST /admin/organizations` sends an invite-notification email when
    the admin is an existing verified user (no activation step needed).
  * `POST /organizations/{org_id}/members` sends an invite-notification
    email when invitee is an existing verified user.
  * `POST /organizations/{org_id}/members/{user_id}/resend-invite` works
    for both unverified (activation re-send) and verified (notification
    re-send) pending invitees.
  * New `/me/invitations` endpoints: list pending, accept, decline.
  * `_flip_pending_memberships` on login is narrowed: existing users with
    active memberships keep new invites pending; only the bootstrap case
    (zero active + exactly one pending) auto-accepts.

The tests bypass the provisioning saga the same way `test_admin_seats.py`
does — direct DB inserts so the test DB doesn't need real per-tenant
schemas. For routes that DO go through the saga (POST /admin/organizations
in the activation-email tests below), we monkeypatch
`bimdossier_api.routers.admin_organizations.provision_organization` to a
minimal stand-in that creates the user + membership without touching the
admin engine.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import pytest
from fastapi_users.password import PasswordHelper
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.tenancy import schema_name_for
from tests.conftest import _audit_rows

if TYPE_CHECKING:
    from bimdossier_api.email.transport import InMemoryEmailTransport


PASSWORD = "correct-horse-battery"


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
) -> User:
    user = User(
        email=email,
        hashed_password=PasswordHelper().hash(PASSWORD),
        full_name=email.split("@")[0],
        is_active=True,
        is_verified=is_verified,
        is_superuser=is_superuser,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_org(
    session: AsyncSession,
    name: str,
    *,
    seat_limit: int | None = None,
) -> Organization:
    org_id = uuid4()
    org = Organization(
        id=org_id,
        name=name,
        schema_name=schema_name_for(org_id),
        status=OrganizationStatus.active,
        provisioned_at=datetime.now(timezone.utc),
        seat_limit=seat_limit,
    )
    session.add(org)
    await session.commit()
    await session.refresh(org)
    return org


async def _add_member(
    session: AsyncSession,
    *,
    user: User,
    org: Organization,
    is_org_admin: bool = False,
    is_guest: bool = False,
    status: OrganizationMemberStatus = OrganizationMemberStatus.active,
) -> OrganizationMember:
    member = OrganizationMember(
        user_id=user.id,
        organization_id=org.id,
        is_org_admin=is_org_admin,
        is_guest=is_guest,
        status=status,
        accepted_at=(
            datetime.now(timezone.utc)
            if status == OrganizationMemberStatus.active
            else None
        ),
    )
    session.add(member)
    if status == OrganizationMemberStatus.active:
        user.active_organization_id = org.id
    await session.commit()
    return member


@pytest.fixture
async def superadmin(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    user = await _make_user(session, "root@example.com", is_superuser=True)
    tokens = await _login(client, user.email)
    return {"token": tokens["access_token"], "user_id": str(user.id)}


# ---------------------------------------------------------------------------
# /admin/organizations — activation / notification email on org create
# ---------------------------------------------------------------------------


@pytest.fixture
def stub_provisioning(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace `provision_organization` in the admin router with a thin
    DB-only impl. Skips schema creation / alembic / grants so tests can
    hit the route without setting up per-tenant schemas."""
    from bimdossier_api.admin import provisioning as prov_module
    from bimdossier_api.db import get_session_maker
    from bimdossier_api.routers import admin_organizations as router_module

    async def _fake_provision(
        *,
        name: str,
        admin_email: str,
        admin_full_name: str | None,
        seat_limit: int | None = None,
        active_storage_limit_gb: int | None = None,
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
                    provisioned_at=datetime.now(timezone.utc),
                    seat_limit=seat_limit,
                    active_storage_limit_gb=active_storage_limit_gb,
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

            # Reload outside the transaction so callers see fresh state.
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


async def test_admin_create_org_sends_activation_email_for_new_admin(
    client: AsyncClient,
    superadmin: dict[str, str],
    email_transport: InMemoryEmailTransport,
    stub_provisioning: None,
) -> None:
    resp = await client.post(
        "/admin/organizations",
        json={
            "name": "FreshCo",
            "admin_email": "fresh-admin@example.com",
            "admin_full_name": "Fresh Admin",
        },
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["activation_required"] is True

    sent = email_transport.last_for("fresh-admin@example.com")
    assert sent is not None, "activation email should have been dispatched"
    assert "Activate" in sent.subject or "activate" in sent.body.lower()
    assert "Token:" in sent.body  # activation token included


async def test_admin_create_org_sends_invite_notification_for_existing_verified_admin(
    client: AsyncClient,
    session: AsyncSession,
    superadmin: dict[str, str],
    email_transport: InMemoryEmailTransport,
    stub_provisioning: None,
) -> None:
    # Pre-existing verified user.
    existing = await _make_user(session, "existing-admin@example.com")

    resp = await client.post(
        "/admin/organizations",
        json={
            "name": "ReuseCo",
            "admin_email": existing.email,
            "admin_full_name": "Existing Admin",
        },
        headers=_auth(superadmin["token"]),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["activation_required"] is False

    sent = email_transport.last_for(existing.email)
    assert sent is not None, "invite notification should have been sent"
    # Notification email is NOT the activation flow → no token line.
    assert "Token:" not in sent.body
    assert "ReuseCo" in sent.body or "ReuseCo" in sent.subject


# ---------------------------------------------------------------------------
# /organizations/{id}/members — invite-notification for existing users
# ---------------------------------------------------------------------------


async def test_invite_existing_verified_user_sends_notification_email(
    client: AsyncClient,
    session: AsyncSession,
    email_transport: InMemoryEmailTransport,
) -> None:
    org = await _make_org(session, "HostCo")
    admin = await _make_user(session, "host-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    invitee = await _make_user(session, "already-verified@example.com")

    tokens = await _login(client, admin.email)
    resp = await client.post(
        f"/organizations/{org.id}/members",
        json={"email": invitee.email},
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "pending"

    sent = email_transport.last_for(invitee.email)
    assert sent is not None
    assert "Token:" not in sent.body  # NOT an activation email
    assert "HostCo" in sent.body or "HostCo" in sent.subject


async def test_resend_invite_sends_notification_for_verified_pending_user(
    client: AsyncClient,
    session: AsyncSession,
    email_transport: InMemoryEmailTransport,
) -> None:
    """Today's resend-invite is a no-op for verified users. After the
    change, it should send the same invite-notification email that the
    initial invite sent."""
    org = await _make_org(session, "ResendCo")
    admin = await _make_user(session, "resend-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)
    invitee = await _make_user(session, "verified-pending@example.com")
    await _add_member(
        session,
        user=invitee,
        org=org,
        status=OrganizationMemberStatus.pending,
    )

    tokens = await _login(client, admin.email)
    email_transport.reset()

    resp = await client.post(
        f"/organizations/{org.id}/members/{invitee.id}/resend-invite",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 204, resp.text

    sent = email_transport.last_for(invitee.email)
    assert sent is not None, "resend should have dispatched a notification email"
    assert "Token:" not in sent.body


# ---------------------------------------------------------------------------
# /me/invitations — list / accept / decline
# ---------------------------------------------------------------------------


async def test_list_my_invitations_returns_only_pending_rows(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    pending_org = await _make_org(session, "PendingCo")
    active_org = await _make_org(session, "ActiveCo")
    user = await _make_user(session, "lister@example.com")
    await _add_member(session, user=user, org=active_org)
    await _add_member(
        session,
        user=user,
        org=pending_org,
        status=OrganizationMemberStatus.pending,
    )

    tokens = await _login(client, user.email)
    resp = await client.get(
        "/me/invitations",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 1
    assert items[0]["organization_id"] == str(pending_org.id)
    assert items[0]["organization_name"] == "PendingCo"


async def test_accept_invitation_flips_to_active(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    org = await _make_org(session, "AcceptCo")
    user = await _make_user(session, "accepter@example.com")
    # User already has an active org so login won't bootstrap-accept.
    home = await _make_org(session, "HomeCo")
    await _add_member(session, user=user, org=home)
    await _add_member(
        session,
        user=user,
        org=org,
        status=OrganizationMemberStatus.pending,
    )

    tokens = await _login(client, user.email)
    resp = await client.post(
        f"/me/invitations/{org.id}/accept",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "active"

    # Verify the row.
    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == user.id,
        OrganizationMember.organization_id == org.id,
    )
    m = (await session.execute(stmt)).scalar_one()
    await session.refresh(m)
    assert m.status == OrganizationMemberStatus.active
    assert m.accepted_at is not None


# ---------------------------------------------------------------------------
# /me/invitations accept — seat backstop (audit finding #16)
# ---------------------------------------------------------------------------


async def test_accept_invitation_succeeds_at_full_capacity(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """Accept is seat-neutral: the pending invite already reserved its seat,
    so accepting at an org that is exactly full (consumed == seat_limit) must
    still succeed. Regression guard against a naive `>=` seat check that would
    409 every legitimate acceptance at a full org."""
    org = await _make_org(session, "FullAcceptCo", seat_limit=2)
    admin = await _make_user(session, "full-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)  # seat 1

    invitee = await _make_user(session, "full-invitee@example.com")
    # Active home org so login won't bootstrap-accept the pending invite.
    home = await _make_org(session, "FAHomeCo")
    await _add_member(session, user=invitee, org=home)
    await _add_member(
        session, user=invitee, org=org, status=OrganizationMemberStatus.pending
    )  # seat 2 → org now exactly full (consumed 2 == limit 2)

    tokens = await _login(client, invitee.email)
    resp = await client.post(
        f"/me/invitations/{org.id}/accept",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "active"


async def test_accept_invitation_blocked_when_over_seat_limit(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """Defense in depth: if the org is already OVER its paid cap (consumed >
    seat_limit) — e.g. a pre-fix invite race, or a cap lowered through a path
    that bypassed the usage guard — accepting must not convert another reserved
    seat into a live active member. The invite stays pending; the admin has to
    reconcile (raise the cap or have an invite declined)."""
    org = await _make_org(session, "OverCapCo", seat_limit=1)
    admin = await _make_user(session, "over-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)  # consumed 1 == limit

    invitee = await _make_user(session, "over-invitee@example.com")
    home = await _make_org(session, "OCHomeCo")
    await _add_member(session, user=invitee, org=home)
    await _add_member(
        session, user=invitee, org=org, status=OrganizationMemberStatus.pending
    )  # consumed 2 > limit 1 — over-provisioned

    tokens = await _login(client, invitee.email)
    resp = await client.post(
        f"/me/invitations/{org.id}/accept",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "SEAT_LIMIT_EXCEEDED"

    # The invite is untouched — still pending, not silently activated.
    m = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == invitee.id,
                OrganizationMember.organization_id == org.id,
            )
        )
    ).scalar_one()
    await session.refresh(m)
    assert m.status == OrganizationMemberStatus.pending


async def test_accept_invitation_guest_bypasses_regular_seat_overage(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """Guests don't consume a host seat (billed against their home org), so a
    guest accept must NOT be blocked just because the org's regular members are
    over cap — mirroring the invite path's `if not is_guest` seat exemption."""
    org = await _make_org(session, "GuestHostCo", seat_limit=1)
    admin = await _make_user(session, "gh-admin@example.com")
    await _add_member(session, user=admin, org=org, is_org_admin=True)  # regular consumed 1 == limit

    guest = await _make_user(session, "gh-guest@example.com")
    home = await _make_org(session, "GHHomeCo")
    await _add_member(session, user=guest, org=home)
    await _add_member(
        session,
        user=guest,
        org=org,
        is_guest=True,
        status=OrganizationMemberStatus.pending,
    )

    tokens = await _login(client, guest.email)
    resp = await client.post(
        f"/me/invitations/{org.id}/accept",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "active"


async def test_decline_invitation_marks_removed(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    org = await _make_org(session, "DeclineCo")
    user = await _make_user(session, "decliner@example.com")
    home = await _make_org(session, "DHomeCo")
    await _add_member(session, user=user, org=home)
    await _add_member(
        session,
        user=user,
        org=org,
        status=OrganizationMemberStatus.pending,
    )

    tokens = await _login(client, user.email)
    resp = await client.post(
        f"/me/invitations/{org.id}/decline",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 204, resp.text

    stmt = select(OrganizationMember).where(
        OrganizationMember.user_id == user.id,
        OrganizationMember.organization_id == org.id,
    )
    m = (await session.execute(stmt)).scalar_one()
    await session.refresh(m)
    assert m.status == OrganizationMemberStatus.removed


async def test_accept_invitation_404_when_no_pending_row(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    user = await _make_user(session, "ghost@example.com")
    home = await _make_org(session, "GhostHomeCo")
    await _add_member(session, user=user, org=home)
    other = await _make_org(session, "NotInvitedCo")

    tokens = await _login(client, user.email)
    resp = await client.post(
        f"/me/invitations/{other.id}/accept",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "INVITATION_NOT_FOUND"


async def test_accept_invitation_409_when_org_deleted(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """If the org was soft-deleted between invite-send and the user's
    accept click, the accept must fail — joining a tombstoned org would
    leave the user with an unusable active membership."""
    org = await _make_org(session, "TombstoneCo")
    user = await _make_user(session, "late@example.com")
    home = await _make_org(session, "LHomeCo")
    await _add_member(session, user=user, org=home)
    await _add_member(
        session,
        user=user,
        org=org,
        status=OrganizationMemberStatus.pending,
    )
    # Soft-delete the org.
    org.deleted_at = datetime.now(timezone.utc)
    await session.commit()

    tokens = await _login(client, user.email)
    resp = await client.post(
        f"/me/invitations/{org.id}/accept",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "ORG_NOT_AVAILABLE"


# ---------------------------------------------------------------------------
# Login no longer blanket-flips pending → active
# ---------------------------------------------------------------------------


async def test_login_does_not_auto_accept_when_user_has_active_orgs(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """If the user already belongs to ≥1 active org, a new pending invite
    must NOT be auto-accepted at login. They have to accept explicitly."""
    user = await _make_user(session, "established@example.com")
    home = await _make_org(session, "EHomeCo")
    pending_org = await _make_org(session, "NewInviteCo")
    await _add_member(session, user=user, org=home)
    await _add_member(
        session,
        user=user,
        org=pending_org,
        status=OrganizationMemberStatus.pending,
    )

    await _login(client, user.email)

    m = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.organization_id == pending_org.id,
            )
        )
    ).scalar_one()
    await session.refresh(m)
    assert m.status == OrganizationMemberStatus.pending


async def test_login_bootstrap_accepts_lone_pending_for_new_user(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """A freshly-activated user with zero active memberships and exactly
    one pending invite is the bootstrap case — auto-accept so the user
    lands logged-in with an active org."""
    user = await _make_user(session, "newcomer@example.com")
    org = await _make_org(session, "BootstrapCo")
    await _add_member(
        session,
        user=user,
        org=org,
        status=OrganizationMemberStatus.pending,
    )

    await _login(client, user.email)

    m = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.organization_id == org.id,
            )
        )
    ).scalar_one()
    await session.refresh(m)
    assert m.status == OrganizationMemberStatus.active


async def test_login_bootstrap_skipped_when_multiple_pending(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """If a brand-new user happens to have multiple pending invites, leave
    them all pending — the user picks via /me/invitations."""
    user = await _make_user(session, "popular-newcomer@example.com")
    org_a = await _make_org(session, "MultiCoA")
    org_b = await _make_org(session, "MultiCoB")
    await _add_member(
        session, user=user, org=org_a, status=OrganizationMemberStatus.pending
    )
    await _add_member(
        session, user=user, org=org_b, status=OrganizationMemberStatus.pending
    )

    await _login(client, user.email)

    rows = (
        await session.execute(
            select(OrganizationMember).where(OrganizationMember.user_id == user.id)
        )
    ).scalars().all()
    for m in rows:
        await session.refresh(m)
    assert {m.status for m in rows} == {OrganizationMemberStatus.pending}


async def test_verify_auto_accepts_bootstrap_pending(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """When a brand-new admin clicks the activation link (POST /auth/verify),
    their sole pending membership flips to active immediately — no second
    "accept" step. Without this hook the user would have to log in to
    trigger the bootstrap rule, and an admin re-sending the invite in
    between would dispatch a confusingly-worded notification email."""
    from fastapi_users.db import SQLAlchemyUserDatabase

    from bimdossier_api.auth.manager import UserManager

    user = await _make_user(session, "bootstrap@example.com", is_verified=False)
    org = await _make_org(session, "FirstHomeCo")
    await _add_member(
        session, user=user, org=org, status=OrganizationMemberStatus.pending
    )

    user_db = SQLAlchemyUserDatabase(session, User)
    manager = UserManager(user_db)
    user.is_verified = True
    await session.flush()
    await manager.on_after_verify(user, request=None)

    m = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.organization_id == org.id,
            )
        )
    ).scalar_one()
    await session.refresh(m)
    assert m.status == OrganizationMemberStatus.active


async def test_verify_does_not_auto_accept_when_user_has_active_orgs(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """A user who already belongs to an active org and gets re-verified
    (rare edge case) must NOT have other pending invites silently
    accepted — same rationale as the login-time narrowing."""
    from fastapi_users.db import SQLAlchemyUserDatabase

    from bimdossier_api.auth.manager import UserManager

    user = await _make_user(session, "already-in@example.com")
    home = await _make_org(session, "HomeC2")
    pending_org = await _make_org(session, "OtherC2")
    await _add_member(session, user=user, org=home)
    await _add_member(
        session, user=user, org=pending_org, status=OrganizationMemberStatus.pending
    )

    user_db = SQLAlchemyUserDatabase(session, User)
    manager = UserManager(user_db)
    await manager.on_after_verify(user, request=None)

    m = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.organization_id == pending_org.id,
            )
        )
    ).scalar_one()
    await session.refresh(m)
    assert m.status == OrganizationMemberStatus.pending


async def test_accepted_invitation_records_audit_entry(
    client: AsyncClient,
    session: AsyncSession,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    org = await _make_org(session, "AuditAcceptCo")
    user = await _make_user(session, "audit-accept@example.com")
    home = await _make_org(session, "AAHomeCo")
    await _add_member(session, user=user, org=home)
    await _add_member(
        session, user=user, org=org, status=OrganizationMemberStatus.pending
    )

    tokens = await _login(client, user.email)
    resp = await client.post(
        f"/me/invitations/{org.id}/accept",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200

    entries = await _audit_rows(
        session_maker, "organization_member.accepted", user_id=user.id
    )
    assert len(entries) == 1


@pytest.mark.asyncio
async def test_login_no_auto_accept_when_removed_from_previous_org(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """A user who was removed from their only org and then invited to a new
    one must NOT be auto-accepted at login. They are a returning user, not
    a bootstrap case."""
    user = await _make_user(session, "removed-then-invited@example.com")
    old_org = await _make_org(session, "FormerCo")
    new_org = await _make_org(session, "NewInviteCo2")
    m_old = await _add_member(session, user=user, org=old_org)
    m_old.status = OrganizationMemberStatus.removed
    user.active_organization_id = None
    await session.commit()

    await _add_member(
        session,
        user=user,
        org=new_org,
        status=OrganizationMemberStatus.pending,
    )

    await _login(client, user.email)

    m = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.organization_id == new_org.id,
            )
        )
    ).scalar_one()
    await session.refresh(m)
    assert m.status == OrganizationMemberStatus.pending


@pytest.mark.asyncio
async def test_auth_me_includes_pending_invitations_count(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """GET /auth/me should return the number of pending invitations."""
    user = await _make_user(session, "count-pending@example.com")
    home = await _make_org(session, "CountHomeCo")
    pending_org = await _make_org(session, "CountPendingCo")
    await _add_member(session, user=user, org=home)
    await _add_member(
        session,
        user=user,
        org=pending_org,
        status=OrganizationMemberStatus.pending,
    )

    tokens = await _login(client, user.email)
    resp = await client.get(
        "/auth/me",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["pending_invitations_count"] == 1


@pytest.mark.asyncio
async def test_auth_me_zero_pending_when_no_invitations(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    """GET /auth/me returns 0 pending when user has no pending invites."""
    user = await _make_user(session, "no-pending@example.com")
    org = await _make_org(session, "NoPendingCo")
    await _add_member(session, user=user, org=org)

    tokens = await _login(client, user.email)
    resp = await client.get(
        "/auth/me",
        headers=_auth(tokens["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["pending_invitations_count"] == 0
