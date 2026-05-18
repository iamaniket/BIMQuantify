"""End-to-end tests for the Borgingsplan + Borgingsmomenten + ChecklistItem stack
(backlog #15, #16, #17).

Covers: template generation, risk-derived items, lifecycle (draft → published →
superseded), versioning, partial-unique-index enforcement, role gating,
moment + checklist-item CRUD, reorder, cascade behaviour, RLS isolation.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.conftest import _add_member, _auth, _create_project


def _payload_create_risk(category: str = "fire_safety", mitigation: str = "Risico A") -> dict:
    return {
        "category": category,
        "level": "high",
        "description": f"Beschrijving {category}",
        "mitigation": mitigation,
        "bbl_article_ref": "4.51",
    }


async def _create_risk(client: AsyncClient, token: str, project_id: str, **kw: str) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/risks",
        json=_payload_create_risk(**kw),
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_creates_draft_plan_with_nl_templates(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])

    resp = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()

    assert body["status"] == "draft"
    assert body["version_number"] == 1
    assert body["created_by_user_id"] == org_user["id"]
    # 8 NL Gk1 baseline moments.
    assert len(body["moments"]) == 8
    phases = {m["phase"] for m in body["moments"]}
    assert phases == {"foundation", "shell", "roof", "finishing", "handover"}
    # Every moment has at least 3 checklist items from the template.
    for m in body["moments"]:
        assert len(m["checklist_items"]) >= 3
        assert m["sequence_in_phase"] >= 0
        for it in m["checklist_items"]:
            assert it["evidence_type"] in {
                "photo",
                "certificate",
                "measurement",
                "document",
                "signature",
            }
            assert it["item_type"] == "text"


@pytest.mark.asyncio
async def test_generate_appends_risk_mitigation_items(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _create_risk(
        client,
        org_user["access_token"],
        project["id"],
        category="fire_safety",
        mitigation="Brandcompartiment-controle uitvoeren",
    )

    resp = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201
    body = resp.json()

    # fire_safety → shell, roof, finishing. So those moments should each have
    # the extra Beheersmaatregel item.
    fire_phases = {"shell", "roof", "finishing"}
    for m in body["moments"]:
        if m["phase"] in fire_phases:
            descriptions = [it["description"] for it in m["checklist_items"]]
            assert any(
                "Beheersmaatregel: Brandcompartiment-controle" in d for d in descriptions
            ), m


@pytest.mark.asyncio
async def test_generate_replaces_existing_draft(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    first = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    assert first.status_code == 201
    first_id = first.json()["id"]

    second = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    assert second.status_code == 201, second.text
    second_body = second.json()
    assert second_body["id"] != first_id
    assert second_body["version_number"] == 1  # draft replaced, not incremented

    versions = await client.get(
        f"/projects/{project['id']}/borgingsplan/versions",
        headers=_auth(org_user["access_token"]),
    )
    assert versions.status_code == 200
    rows = versions.json()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_generate_blocked_when_published_without_force(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    pub = await client.post(
        f"/projects/{project['id']}/borgingsplan/publish",
        headers=_auth(org_user["access_token"]),
    )
    assert pub.status_code == 200

    conflict = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={"force": False},
        headers=_auth(org_user["access_token"]),
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "PUBLISHED_PLAN_EXISTS"


@pytest.mark.asyncio
async def test_generate_with_force_supersedes_published(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/borgingsplan/publish",
        headers=_auth(org_user["access_token"]),
    )

    forced = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={"force": True},
        headers=_auth(org_user["access_token"]),
    )
    assert forced.status_code == 201, forced.text
    assert forced.json()["version_number"] == 2
    assert forced.json()["status"] == "draft"

    versions = await client.get(
        f"/projects/{project['id']}/borgingsplan/versions",
        headers=_auth(org_user["access_token"]),
    )
    assert versions.status_code == 200
    rows = versions.json()
    assert len(rows) == 2
    statuses_by_version = {r["version_number"]: r["status"] for r in rows}
    assert statuses_by_version[1] == "superseded"
    assert statuses_by_version[2] == "draft"


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_returns_404_when_no_plan(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/borgingsplan",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "NO_ACTIVE_PLAN"


@pytest.mark.asyncio
async def test_publish_flips_status_and_sets_published_at(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.post(
        f"/projects/{project['id']}/borgingsplan/publish",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "published"
    assert body["published_at"] is not None


@pytest.mark.asyncio
async def test_publish_requires_owner_role(
    client: AsyncClient,
    org_user: dict,
    same_org_user: dict,
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _add_member(client, org_user["access_token"], project["id"], same_org_user["id"], "editor")
    await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(same_org_user["access_token"]),
    )

    resp = await client.post(
        f"/projects/{project['id']}/borgingsplan/publish",
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "INSUFFICIENT_PROJECT_ROLE"


@pytest.mark.asyncio
async def test_new_version_clones_and_supersedes(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    plan_v1 = gen.json()
    await client.post(
        f"/projects/{project['id']}/borgingsplan/publish",
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.post(
        f"/projects/{project['id']}/borgingsplan/new-version",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    new_plan = resp.json()
    assert new_plan["version_number"] == 2
    assert new_plan["status"] == "draft"
    assert len(new_plan["moments"]) == len(plan_v1["moments"])
    # IDs differ — a real clone, not a re-key.
    v1_ids = {m["id"] for m in plan_v1["moments"]}
    v2_ids = {m["id"] for m in new_plan["moments"]}
    assert v1_ids.isdisjoint(v2_ids)


@pytest.mark.asyncio
async def test_new_version_blocked_on_draft(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    resp = await client.post(
        f"/projects/{project['id']}/borgingsplan/new-version",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "PLAN_NOT_PUBLISHED"


@pytest.mark.asyncio
async def test_list_versions_returns_published_and_superseded(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/borgingsplan/publish",
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/borgingsplan/new-version",
        headers=_auth(org_user["access_token"]),
    )

    versions = await client.get(
        f"/projects/{project['id']}/borgingsplan/versions",
        headers=_auth(org_user["access_token"]),
    )
    assert versions.status_code == 200
    rows = versions.json()
    assert [r["version_number"] for r in rows] == [2, 1]
    assert rows[0]["status"] == "draft"
    assert rows[1]["status"] == "superseded"


@pytest.mark.asyncio
async def test_reset_replaces_draft_only(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    plan_id = gen.json()["id"]

    # Add a custom moment to the draft.
    add_resp = await client.post(
        f"/borgingsplans/{plan_id}/moments",
        json={
            "phase": "other",
            "name": "Aangepast moment",
            "planned_date": "2026-09-01",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert add_resp.status_code == 201, add_resp.text

    reset = await client.post(
        f"/projects/{project['id']}/borgingsplan/{plan_id}/reset",
        headers=_auth(org_user["access_token"]),
    )
    assert reset.status_code == 200, reset.text
    reset_body = reset.json()
    # Same version, but fresh template — custom moment is gone.
    assert reset_body["version_number"] == 1
    other_moments = [m for m in reset_body["moments"] if m["phase"] == "other"]
    assert other_moments == []


@pytest.mark.asyncio
async def test_reset_blocked_on_published(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    plan_id = gen.json()["id"]
    await client.post(
        f"/projects/{project['id']}/borgingsplan/publish",
        headers=_auth(org_user["access_token"]),
    )
    resp = await client.post(
        f"/projects/{project['id']}/borgingsplan/{plan_id}/reset",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "PLAN_NOT_EDITABLE"


@pytest.mark.asyncio
async def test_partial_unique_index_blocks_two_active_plans(
    client: AsyncClient,
    org_user: dict,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The partial unique index `ux_borgingsplans_one_active` should refuse
    two rows in (draft | published) for the same project."""
    from sqlalchemy.exc import IntegrityError

    from bimstitch_api.models.borgingsplan import Borgingsplan, BorgingsplanStatus

    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )

    async with session_maker() as s:
        rogue = Borgingsplan(
            id=uuid.uuid4(),
            project_id=uuid.UUID(project["id"]),
            version_number=99,
            status=BorgingsplanStatus.draft,
            created_by_user_id=uuid.UUID(org_user["id"]),
        )
        s.add(rogue)
        with pytest.raises(IntegrityError):
            await s.commit()


# ---------------------------------------------------------------------------
# Moments + checklist items
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_moment_appends_to_phase_sequence(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    plan_id = gen.json()["id"]

    resp = await client.post(
        f"/borgingsplans/{plan_id}/moments",
        json={
            "phase": "shell",
            "name": "Extra controle",
            "planned_date": "2026-07-01",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    # Existing shell moments come from templates with seq 0+1; new one should be 2.
    assert body["sequence_in_phase"] == 2


@pytest.mark.asyncio
async def test_update_moment_partial(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    plan = gen.json()
    plan_id = plan["id"]
    moment = plan["moments"][0]

    resp = await client.patch(
        f"/borgingsplans/{plan_id}/moments/{moment['id']}",
        json={"name": "Hernoemd"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Hernoemd"
    # Other fields untouched.
    assert resp.json()["phase"] == moment["phase"]


@pytest.mark.asyncio
async def test_delete_moment_cascades_checklist_items(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    plan = gen.json()
    plan_id = plan["id"]
    moment = plan["moments"][0]
    item_id = moment["checklist_items"][0]["id"]

    delete = await client.delete(
        f"/borgingsplans/{plan_id}/moments/{moment['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert delete.status_code == 204

    # The item should also be gone (404 on PATCH).
    update = await client.patch(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item_id}",
        json={"description": "fail"},
        headers=_auth(org_user["access_token"]),
    )
    assert update.status_code == 404


@pytest.mark.asyncio
async def test_moment_writes_blocked_when_published(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    plan_id = gen.json()["id"]
    moment = gen.json()["moments"][0]
    await client.post(
        f"/projects/{project['id']}/borgingsplan/publish",
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.patch(
        f"/borgingsplans/{plan_id}/moments/{moment['id']}",
        json={"name": "Niet toegestaan"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "PLAN_NOT_EDITABLE"


@pytest.mark.asyncio
async def test_reorder_moments_within_phase(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    plan = gen.json()
    plan_id = plan["id"]
    shell_moments = sorted(
        [m for m in plan["moments"] if m["phase"] == "shell"],
        key=lambda m: m["sequence_in_phase"],
    )
    reversed_ids = [m["id"] for m in reversed(shell_moments)]

    resp = await client.post(
        f"/borgingsplans/{plan_id}/moments/reorder",
        json={"phase": "shell", "moment_ids": reversed_ids},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    new_order = sorted(resp.json(), key=lambda m: m["sequence_in_phase"])
    assert [m["id"] for m in new_order] == reversed_ids


@pytest.mark.asyncio
async def test_create_checklist_item(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    moment = gen.json()["moments"][0]
    initial_count = len(moment["checklist_items"])

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items",
        json={
            "description": "Nieuw item",
            "evidence_type": "photo",
            "bbl_article_ref": "9.99",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["description"] == "Nieuw item"
    assert body["evidence_type"] == "photo"
    assert body["bbl_article_ref"] == "9.99"
    assert body["sequence"] == initial_count  # appended


@pytest.mark.asyncio
async def test_create_checklist_item_invalid_evidence_type_returns_422(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    moment = gen.json()["moments"][0]

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items",
        json={
            "description": "Foute evidence",
            "evidence_type": "unicorn",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_reorder_checklist_items(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    moment = gen.json()["moments"][0]
    items = moment["checklist_items"]
    reversed_ids = [it["id"] for it in reversed(items)]

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/reorder",
        json={"item_ids": reversed_ids},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    new_order = sorted(resp.json(), key=lambda it: it["sequence"])
    assert [it["id"] for it in new_order] == reversed_ids


@pytest.mark.asyncio
async def test_delete_checklist_item(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    moment = gen.json()["moments"][0]
    item_id = moment["checklist_items"][0]["id"]

    resp = await client.delete(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item_id}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204


# ---------------------------------------------------------------------------
# Role gating
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_moment_create_requires_editor_role(
    client: AsyncClient,
    org_user: dict,
    same_org_user: dict,
) -> None:
    project = await _create_project(client, org_user["access_token"])
    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    plan_id = gen.json()["id"]
    await _add_member(client, org_user["access_token"], project["id"], same_org_user["id"], "viewer")

    resp = await client.post(
        f"/borgingsplans/{plan_id}/moments",
        json={
            "phase": "other",
            "name": "Viewer attempt",
            "planned_date": "2026-09-01",
        },
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# RLS isolation + cascades
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_plan_rls_isolation_across_orgs(
    client: AsyncClient,
    org_user: dict,
    other_org_user: dict,
) -> None:
    alpha_project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{alpha_project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )

    # Beta user fetching alpha's plan should see 404 (RLS filters projects;
    # _require_membership then 404s before reaching the borgingsplan loader).
    cross = await client.get(
        f"/projects/{alpha_project['id']}/borgingsplan",
        headers=_auth(other_org_user["access_token"]),
    )
    assert cross.status_code == 404


@pytest.mark.asyncio
async def test_cascade_on_project_delete(
    client: AsyncClient,
    org_user: dict,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    from sqlalchemy import select

    from bimstitch_api.models.borgingsmoment import Borgingsmoment
    from bimstitch_api.models.borgingsplan import Borgingsplan
    from bimstitch_api.models.checklist_item import ChecklistItem
    from bimstitch_api.models.project import Project

    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )

    project_uuid = uuid.UUID(project["id"])
    async with session_maker() as s:
        # Hard-delete the project row to trigger FK CASCADE (not the soft-delete
        # archive endpoint, which only flips lifecycle_state).
        proj = (await s.execute(select(Project).where(Project.id == project_uuid))).scalar_one()
        await s.delete(proj)
        await s.commit()

    async with session_maker() as s:
        plans = (
            await s.execute(
                select(Borgingsplan).where(Borgingsplan.project_id == project_uuid)
            )
        ).scalars().all()
        moments = (
            await s.execute(
                select(Borgingsmoment).where(Borgingsmoment.project_id == project_uuid)
            )
        ).scalars().all()
        items = (
            await s.execute(
                select(ChecklistItem).where(ChecklistItem.project_id == project_uuid)
            )
        ).scalars().all()
    assert plans == []
    assert moments == []
    assert items == []


@pytest.mark.asyncio
async def test_archived_project_rejects_writes(
    client: AsyncClient, org_user: dict
) -> None:
    project = await _create_project(client, org_user["access_token"])
    archive = await client.post(
        f"/projects/{project['id']}/archive",
        headers=_auth(org_user["access_token"]),
    )
    assert archive.status_code == 200

    resp = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "PROJECT_ARCHIVED"


# ---------------------------------------------------------------------------
# Jurisdiction endpoint extension
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jurisdictions_endpoint_exposes_borgingsplan_data(
    client: AsyncClient,
) -> None:
    resp = await client.get("/jurisdictions")
    assert resp.status_code == 200
    by_country = {j["country"]: j for j in resp.json()["items"]}
    nl = by_country["NL"]
    assert set(nl["borgingsmoment_phase_labels"].keys()) == {
        "foundation",
        "shell",
        "roof",
        "finishing",
        "handover",
        "other",
    }
    assert len(nl["borgingsmoment_templates"]) >= 8
    assert set(nl["risk_category_to_phases"].keys()) == {
        "structural_safety",
        "fire_safety",
        "health",
        "energy_efficiency",
        "usability",
    }


@pytest.mark.asyncio
async def test_generate_uses_planned_start_date_for_offsets(
    client: AsyncClient,
    org_user: dict,
) -> None:
    """If Project.planned_start_date is set, moments' planned_date should be
    base_date + each template's default_offset_days."""
    # Create a project with planned_start_date in the future.
    resp = await client.post(
        "/projects",
        json={"name": "Datumtest", "planned_start_date": "2027-01-15"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    project = resp.json()

    gen = await client.post(
        f"/projects/{project['id']}/borgingsplan/generate",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    assert gen.status_code == 201
    plan = gen.json()
    foundation = [m for m in plan["moments"] if m["phase"] == "foundation"][0]
    assert foundation["planned_date"] == "2027-01-15"
    handover = [m for m in plan["moments"] if m["phase"] == "handover"][0]
    # Handover offset is 140 days.
    expected_handover = (dt.date(2027, 1, 15) + dt.timedelta(days=140)).isoformat()
    assert handover["planned_date"] == expected_handover
