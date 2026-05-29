"""Audit-log wiring smoke tests — backlog #36 + #7.

Verifies that mutating endpoints emit AuditLog rows with the expected
``action``, ``before``, and ``after`` fields, and that permission denials
produce ``permission.denied`` entries that survive the tenant-transaction
rollback (they use a separate master session).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from tests.conftest import (
    _PLATFORM_ORG_ID_HEX,
    _add_member,
    _auth,
    _create_project,
    _latest_audit,
)

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _risk_payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "category": "fire_safety",
        "level": "medium",
        "description": "Compartimentering tussen woningen",
        "mitigation": "60 min WBDBO aantonen op tekening.",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Risk CRUD — audit entries
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_risk_emits_audit_row(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/risks",
        json=_risk_payload(),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201

    row = await _latest_audit(session_maker, "risk.created")
    assert row is not None, "Expected risk.created audit entry"
    assert row.resource_type == "risk"
    assert row.before is None  # creates have no before state
    assert row.after is not None
    assert row.after["category"] == "fire_safety"
    assert row.after["level"] == "medium"
    assert "mitigation" in row.after


@pytest.mark.asyncio
async def test_update_risk_emits_audit_row_with_before_after(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    risk = (
        await client.post(
            f"/projects/{project['id']}/risks",
            json=_risk_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.patch(
        f"/projects/{project['id']}/risks/{risk['id']}",
        json={"level": "high"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200

    row = await _latest_audit(session_maker, "risk.updated")
    assert row is not None, "Expected risk.updated audit entry"
    assert row.resource_type == "risk"
    assert row.before is not None
    assert row.after is not None
    assert row.before["level"] == "medium"
    assert row.after["level"] == "high"


@pytest.mark.asyncio
async def test_delete_risk_emits_audit_row_with_before_only(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    risk = (
        await client.post(
            f"/projects/{project['id']}/risks",
            json=_risk_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.delete(
        f"/projects/{project['id']}/risks/{risk['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204

    row = await _latest_audit(session_maker, "risk.deleted")
    assert row is not None, "Expected risk.deleted audit entry"
    assert row.resource_type == "risk"
    assert row.before is not None
    assert row.after is None  # deletes have no after state
    assert row.before["category"] == "fire_safety"


# ---------------------------------------------------------------------------
# Permission denial logging
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_viewer_denied_creates_permission_denied_audit_row(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    """Viewer attempting to create a risk → 403 + a permission.denied audit entry.

    Uses ``same_org_non_admin_user`` (dave, is_org_admin=False) so that he is
    NOT auto-seeded as editor when the project is created — which would make
    adding him as viewer fail with MEMBER_ALREADY_EXISTS.

    The denial entry must be persisted even though the tenant transaction
    rolled back — it uses a separate master session in log_permission_denied().
    """
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "viewer",
    )

    # Viewer tries to create a risk → must be rejected
    resp = await client.post(
        f"/projects/{project['id']}/risks",
        json=_risk_payload(),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403

    # The denial entry survives the rolled-back 403 transaction
    row = await _latest_audit(session_maker, "permission.denied")
    assert row is not None, "Expected permission.denied audit entry"
    assert row.before is not None
    assert row.before["role"] == "viewer"
    assert row.before["resource"] == "risk"
    assert row.before["action"] == "create"


# ---------------------------------------------------------------------------
# Org-less events land in the platform schema
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_failed_login_records_into_platform_schema(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A failed login has no subject org, so its audit row must land in the
    platform org's schema — not in `public`, not in any tenant schema."""
    import uuid

    from sqlalchemy import select

    from bimstitch_api.models.audit_log import AuditLog
    from bimstitch_api.tenancy import schema_name_for

    bogus = f"nobody-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(
        "/auth/jwt/login",
        data={"username": bogus, "password": "definitely-wrong"},
    )
    assert resp.status_code == 400

    platform_schema = schema_name_for(uuid.UUID(_PLATFORM_ORG_ID_HEX))
    async with session_maker() as s:
        rows = (
            await s.execute(
                select(AuditLog).where(
                    AuditLog.action == "auth.login.failure"
                ),
                execution_options={"schema_translate_map": {None: platform_schema}},
            )
        ).scalars().all()
    matching = [r for r in rows if r.after and r.after.get("email") == bogus]
    assert len(matching) == 1, "Expected failed-login row in the platform schema"


# ---------------------------------------------------------------------------
# Borgingsplan lifecycle — audit entries
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_publish_borgingsplan_emits_audit_row(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"], name="AuditPlan")

    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    assert gen.status_code == 201, gen.text

    pub = await client.post(
        f"/projects/{project['id']}/borgingsplan/publish",
        headers=_auth(org_user["access_token"]),
    )
    assert pub.status_code == 200, pub.text

    row = await _latest_audit(session_maker, "borgingsplan.published")
    assert row is not None, "Expected borgingsplan.published audit entry"
    assert row.resource_type == "borgingsplan"
    assert row.before is not None
    assert row.after is not None
    assert row.before["status"] == "draft"
    assert row.after["status"] == "published"
