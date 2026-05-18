"""HTTP-level integration tests for Risk (Risicobeoordeling) CRUD.

Wkb MVP backlog #13 acceptance: schema applies, CRUD APIs per project,
role-gated writes, RLS isolation across tenants.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import text

from tests.conftest import _add_member, _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def _payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "category": "fire_safety",
        "level": "medium",
        "description": "Compartimentering tussen woningen",
        "mitigation": "60 min WBDBO aantonen op tekening + uitvoeringscontrole.",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


async def test_create_risk_minimal(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["category"] == "fire_safety"
    assert body["level"] == "medium"
    assert body["description"] == "Compartimentering tussen woningen"
    assert body["project_id"] == project["id"]
    assert body["bbl_article_ref"] is None
    assert body["responsible_party"] is None
    assert "id" in body and "created_at" in body and "updated_at" in body


async def test_create_risk_with_bbl_article_ref(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(
            bbl_article_ref="4.51",
            responsible_party="Hoofdaannemer",
            level="high",
        ),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["bbl_article_ref"] == "4.51"
    assert body["responsible_party"] == "Hoofdaannemer"
    assert body["level"] == "high"


async def test_create_risk_invalid_category_returns_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(category="totally_made_up"),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_create_risk_invalid_level_returns_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(level="catastrophic"),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_create_risk_description_required(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(description=""),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_create_risk_bbl_article_ref_max_length(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(bbl_article_ref="x" * 51),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# List / get
# ---------------------------------------------------------------------------


async def test_list_risks_empty(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/risks",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_risks_orders_by_category_level_created_at(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    # Postgres enums sort by *declaration order* (ordinal), not by the
    # underlying string. RiskCategory declares structural_safety BEFORE
    # fire_safety, so structural_safety comes first. RiskLevel declares
    # low → medium → high in that order.
    await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(category="fire_safety", level="low", description="F-low"),
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(category="structural_safety", level="high", description="S-high"),
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(category="fire_safety", level="high", description="F-high"),
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project['id']}/risks",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert [(r["category"], r["level"]) for r in items] == [
        ("structural_safety", "high"),
        ("fire_safety", "low"),
        ("fire_safety", "high"),
    ]


async def test_get_risk_returns_the_risk(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/risks",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    resp = await client.get(
        f"/projects/{project['id']}/risks/{created['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == created["id"]


async def test_get_risk_returns_404_when_under_different_project(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project_a = await _create_project(client, org_user["access_token"], name="A")
    project_b = await _create_project(client, org_user["access_token"], name="B")
    risk = (
        await client.post(
            f"/projects/{project_a['id']}/risks",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    # The risk id exists, but under project_a — fetching it under project_b
    # must surface as 404, not 200.
    resp = await client.get(
        f"/projects/{project_b['id']}/risks/{risk['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_get_risk_404_unknown_id(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/risks/{uuid4()}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Patch / delete
# ---------------------------------------------------------------------------


async def test_update_risk_partial_preserves_untouched_fields(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/risks",
            json=_payload(bbl_article_ref="4.51"),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.patch(
        f"/projects/{project['id']}/risks/{created['id']}",
        json={"level": "high"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["level"] == "high"
    # Untouched fields stay put.
    assert body["category"] == created["category"]
    assert body["description"] == created["description"]
    assert body["bbl_article_ref"] == "4.51"
    # updated_at advances.
    assert body["updated_at"] >= created["updated_at"]


async def test_delete_risk_then_get_returns_404(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/risks",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.delete(
        f"/projects/{project['id']}/risks/{created['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204

    follow = await client.get(
        f"/projects/{project['id']}/risks/{created['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert follow.status_code == 404


# ---------------------------------------------------------------------------
# Membership + role enforcement
# ---------------------------------------------------------------------------


async def test_risk_requires_membership_for_get(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    """Same org, but not a project member — must 404 (existence-leak closed)."""
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/risks",
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_risk_viewer_can_read_but_not_write(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_user["id"],
        "viewer",
    )
    # Owner seeds a risk.
    created = (
        await client.post(
            f"/projects/{project['id']}/risks",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    # Viewer can list + get.
    list_resp = await client.get(
        f"/projects/{project['id']}/risks",
        headers=_auth(same_org_user["access_token"]),
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    # Viewer cannot POST.
    post_resp = await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(description="viewer-attempt"),
        headers=_auth(same_org_user["access_token"]),
    )
    assert post_resp.status_code == 403

    # Viewer cannot PATCH.
    patch_resp = await client.patch(
        f"/projects/{project['id']}/risks/{created['id']}",
        json={"level": "high"},
        headers=_auth(same_org_user["access_token"]),
    )
    assert patch_resp.status_code == 403

    # Viewer cannot DELETE.
    del_resp = await client.delete(
        f"/projects/{project['id']}/risks/{created['id']}",
        headers=_auth(same_org_user["access_token"]),
    )
    assert del_resp.status_code == 403


async def test_risk_editor_can_write(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_user["id"],
        "editor",
    )
    resp = await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(description="editor-write"),
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text


async def test_risk_rejected_when_project_archived(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    arch = await client.post(
        f"/projects/{project['id']}/archive",
        headers=_auth(org_user["access_token"]),
    )
    assert arch.status_code == 200

    resp = await client.post(
        f"/projects/{project['id']}/risks",
        json=_payload(),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "PROJECT_ARCHIVED"


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------


async def test_risk_invisible_across_orgs(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    project_a = await _create_project(client, org_user["access_token"], name="AlphaP")
    await client.post(
        f"/projects/{project_a['id']}/risks",
        json=_payload(description="alpha-only"),
        headers=_auth(org_user["access_token"]),
    )

    # Other org tries to list risks on AlphaCo's project — must 404 (RLS
    # filters projects.id before _load_project_or_404 even sees the row).
    resp = await client.get(
        f"/projects/{project_a['id']}/risks",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_risk_cascade_on_project_hard_delete(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Hard-deleting the parent project at the DB layer removes its risks
    (FK ondelete=CASCADE). The HTTP delete only soft-deletes, so test the
    cascade via raw SQL."""
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/risks",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    async with session_maker() as session:
        await session.execute(
            text("DELETE FROM projects WHERE id = :pid"),
            {"pid": project["id"]},
        )
        await session.commit()
        rows = (
            await session.execute(
                text("SELECT id FROM risks WHERE id = :rid"),
                {"rid": created["id"]},
            )
        ).all()
    assert rows == []
