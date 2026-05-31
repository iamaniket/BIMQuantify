"""Tests for the inspection execution endpoints (backlog #19).

Covers: start-inspection, submit verdict, list results, summary, complete,
authorization, and tenant isolation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from tests.conftest import (
    _add_member,
    _auth,
    _create_project,
    _provision_user_in_org,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _generate_borgingsplan(
    client: AsyncClient, token: str, project_id: str
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/borgingsplan/generate",
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _first_moment(plan: dict) -> dict:
    return plan["moments"][0]


def _first_item(moment: dict) -> dict:
    return moment["checklist_items"][0]


# ---------------------------------------------------------------------------
# start-inspection
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_start_inspection_transitions_planned_to_in_progress(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "in_progress"
    assert body["actual_date"] is not None


@pytest.mark.anyio
async def test_start_inspection_is_idempotent(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )
    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"


@pytest.mark.anyio
async def test_start_inspection_rejects_completed_moment(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)

    # Start + submit all items + complete
    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )
    for item in moment["checklist_items"]:
        await client.post(
            f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
            json={"verdict": "pass"},
            headers=_auth(user["access_token"]),
        )
    await client.post(
        f"/borgingsmomenten/{moment['id']}/complete-inspection",
        headers=_auth(user["access_token"]),
    )

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "MOMENT_ALREADY_COMPLETED"


# ---------------------------------------------------------------------------
# submit result
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_submit_verdict_pass(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)
    item = _first_item(moment)

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
        json={"verdict": "pass"},
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["verdict"] == "pass"
    assert body["checklist_item_id"] == item["id"]
    assert body["borgingsmoment_id"] == moment["id"]
    assert body["inspector_user_id"] == user["id"]


@pytest.mark.anyio
async def test_submit_verdict_upsert_replaces(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)
    item = _first_item(moment)

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )

    await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
        json={"verdict": "pass"},
        headers=_auth(user["access_token"]),
    )
    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
        json={"verdict": "fail", "note": "Changed my mind"},
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 201
    assert resp.json()["verdict"] == "fail"
    assert resp.json()["note"] == "Changed my mind"

    results_resp = await client.get(
        f"/borgingsmomenten/{moment['id']}/results",
        headers=_auth(user["access_token"]),
    )
    assert len(results_resp.json()) == 1


@pytest.mark.anyio
async def test_submit_nvt_requires_note(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)
    item = _first_item(moment)

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
        json={"verdict": "not_applicable"},
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "NVT_REQUIRES_NOTE"

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
        json={"verdict": "not_applicable", "note": "Niet van toepassing: geen trappenhuis"},
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 201


@pytest.mark.anyio
async def test_submit_rejects_wrong_item_moment(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moments = plan["moments"]
    assert len(moments) >= 2, "Need at least 2 moments for cross-moment test"

    moment_a = moments[0]
    item_from_b = moments[1]["checklist_items"][0]

    await client.post(
        f"/borgingsmomenten/{moment_a['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )

    resp = await client.post(
        f"/borgingsmomenten/{moment_a['id']}/checklist-items/{item_from_b['id']}/result",
        json={"verdict": "pass"},
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "CHECKLIST_ITEM_NOT_FOUND"


# ---------------------------------------------------------------------------
# list results
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_list_results_empty(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)

    resp = await client.get(
        f"/borgingsmomenten/{moment['id']}/results",
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.anyio
async def test_list_results_ordered_by_checklist_sequence(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)
    items = moment["checklist_items"]
    assert len(items) >= 2

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )

    # Submit in reverse order
    for item in reversed(items):
        await client.post(
            f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
            json={"verdict": "pass"},
            headers=_auth(user["access_token"]),
        )

    resp = await client.get(
        f"/borgingsmomenten/{moment['id']}/results",
        headers=_auth(user["access_token"]),
    )
    result_ids = [r["checklist_item_id"] for r in resp.json()]
    item_ids = [i["id"] for i in items]
    assert result_ids == item_ids


# ---------------------------------------------------------------------------
# inspection summary
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_inspection_summary_counts(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)
    items = moment["checklist_items"]
    total = len(items)

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )

    # Submit first item as pass
    await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{items[0]['id']}/result",
        json={"verdict": "pass"},
        headers=_auth(user["access_token"]),
    )

    resp = await client.get(
        f"/borgingsmomenten/{moment['id']}/inspection-summary",
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_items"] == total
    assert body["completed"] == 1
    assert body["passed"] == 1
    assert body["failed"] == 0
    assert body["not_applicable"] == 0
    assert body["remaining"] == total - 1


# ---------------------------------------------------------------------------
# complete-inspection
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_complete_inspection_all_pass(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )
    for item in moment["checklist_items"]:
        await client.post(
            f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
            json={"verdict": "pass"},
            headers=_auth(user["access_token"]),
        )

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/complete-inspection",
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "passed"


@pytest.mark.anyio
async def test_complete_inspection_with_failure(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)
    items = moment["checklist_items"]

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )
    await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{items[0]['id']}/result",
        json={"verdict": "fail", "note": "Niet conform"},
        headers=_auth(user["access_token"]),
    )
    for item in items[1:]:
        await client.post(
            f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
            json={"verdict": "pass"},
            headers=_auth(user["access_token"]),
        )

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/complete-inspection",
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "failed"


@pytest.mark.anyio
async def test_complete_rejects_incomplete(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/complete-inspection",
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "INCOMPLETE_INSPECTION"


@pytest.mark.anyio
async def test_complete_rejects_planned_moment(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/complete-inspection",
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "MOMENT_NOT_IN_PROGRESS"


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_viewer_can_read_but_not_submit(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    owner = await _provision_user_in_org(
        client, session_maker, engine,
        email="owner@test.nl", organization_name="TestOrg",
    )
    # is_org_admin=False so _seed_project_members doesn't auto-add as editor
    viewer = await _provision_user_in_org(
        client, session_maker, engine,
        email="viewer@test.nl", organization_name="TestOrg",
        is_org_admin=False,
    )
    project = await _create_project(client, owner["access_token"])
    await _add_member(
        client, owner["access_token"], project["id"], viewer["id"], "viewer",
    )
    plan = await _generate_borgingsplan(client, owner["access_token"], project["id"])
    moment = _first_moment(plan)
    item = _first_item(moment)

    # Viewer can read results
    resp = await client.get(
        f"/borgingsmomenten/{moment['id']}/results",
        headers=_auth(viewer["access_token"]),
    )
    assert resp.status_code == 200

    # Viewer can read summary
    resp = await client.get(
        f"/borgingsmomenten/{moment['id']}/inspection-summary",
        headers=_auth(viewer["access_token"]),
    )
    assert resp.status_code == 200

    # Viewer cannot start inspection
    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(viewer["access_token"]),
    )
    assert resp.status_code == 403

    # Start as owner, then viewer cannot submit
    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(owner["access_token"]),
    )
    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
        json={"verdict": "pass"},
        headers=_auth(viewer["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_non_member_gets_404(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    owner = await _provision_user_in_org(
        client, session_maker, engine,
        email="owner@test.nl", organization_name="OrgA",
    )
    outsider = await _provision_user_in_org(
        client, session_maker, engine,
        email="outsider@test.nl", organization_name="OrgB",
    )
    project = await _create_project(client, owner["access_token"])
    plan = await _generate_borgingsplan(client, owner["access_token"], project["id"])
    moment = _first_moment(plan)

    resp = await client.get(
        f"/borgingsmomenten/{moment['id']}/results",
        headers=_auth(outsider["access_token"]),
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_inspector_role_can_submit(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    owner = await _provision_user_in_org(
        client, session_maker, engine,
        email="owner@test.nl", organization_name="TestOrg",
    )
    inspector = await _provision_user_in_org(
        client, session_maker, engine,
        email="inspector@test.nl", organization_name="TestOrg",
        is_org_admin=False,
    )
    project = await _create_project(client, owner["access_token"])
    await _add_member(
        client, owner["access_token"], project["id"], inspector["id"], "inspector",
    )
    plan = await _generate_borgingsplan(client, owner["access_token"], project["id"])
    moment = _first_moment(plan)
    item = _first_item(moment)

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(inspector["access_token"]),
    )
    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
        json={"verdict": "pass"},
        headers=_auth(inspector["access_token"]),
    )
    assert resp.status_code == 201


# ---------------------------------------------------------------------------
# Archived project
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_start_inspection_rejected_when_project_archived(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="arch-insp@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)

    archive = await client.post(
        f"/projects/{project['id']}/archive",
        headers=_auth(user["access_token"]),
    )
    assert archive.status_code == 200

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "PROJECT_ARCHIVED"


# ---------------------------------------------------------------------------
# reference_attachment_ids
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_submit_result_with_reference_attachment_ids(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    from uuid import uuid4

    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)
    item = _first_item(moment)

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )

    ref_ids = [str(uuid4()), str(uuid4())]
    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
        json={"verdict": "pass", "reference_attachment_ids": ref_ids},
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["reference_attachment_ids"] == ref_ids

    results = await client.get(
        f"/borgingsmomenten/{moment['id']}/results",
        headers=_auth(user["access_token"]),
    )
    assert results.status_code == 200
    found = [r for r in results.json() if r["checklist_item_id"] == item["id"]]
    assert len(found) == 1
    assert found[0]["reference_attachment_ids"] == ref_ids


@pytest.mark.anyio
async def test_submit_result_reference_attachment_ids_default_null(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
) -> None:
    user = await _provision_user_in_org(
        client, session_maker, engine, email="kb@test.nl"
    )
    project = await _create_project(client, user["access_token"])
    plan = await _generate_borgingsplan(client, user["access_token"], project["id"])
    moment = _first_moment(plan)
    item = _first_item(moment)

    await client.post(
        f"/borgingsmomenten/{moment['id']}/start-inspection",
        headers=_auth(user["access_token"]),
    )

    resp = await client.post(
        f"/borgingsmomenten/{moment['id']}/checklist-items/{item['id']}/result",
        json={"verdict": "pass"},
        headers=_auth(user["access_token"]),
    )
    assert resp.status_code == 201
    assert resp.json()["reference_attachment_ids"] is None
