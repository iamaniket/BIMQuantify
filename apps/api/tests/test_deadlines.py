"""Integration tests for deadline tracker (backlog #28).

Covers: auto-seed on project create, recompute on PATCH, CRUD endpoints,
is_overdue computation, mark-as-met, permission gates, RLS isolation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.conftest import _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_project_with_dates(
    client: AsyncClient,
    token: str,
    *,
    planned_start_date: str | None = "2026-09-01",
    delivery_date: str | None = "2027-03-01",
    name: str = "Deadline Project",
) -> dict:
    payload: dict[str, object] = {"name": name}
    if planned_start_date is not None:
        payload["planned_start_date"] = planned_start_date
    if delivery_date is not None:
        payload["delivery_date"] = delivery_date
    resp = await client.post("/projects", json=payload, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _list_deadlines(client: AsyncClient, token: str, project_id: str) -> list[dict]:
    resp = await client.get(
        f"/projects/{project_id}/deadlines", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _get_deadline(
    client: AsyncClient, token: str, project_id: str, deadline_id: str
) -> dict:
    resp = await client.get(
        f"/projects/{project_id}/deadlines/{deadline_id}",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _mark_met(
    client: AsyncClient, token: str, project_id: str, deadline_id: str
) -> dict:
    resp = await client.patch(
        f"/projects/{project_id}/deadlines/{deadline_id}",
        json={},
        headers=_auth(token),
    )
    return resp.json() if resp.status_code == 200 else {"_status": resp.status_code, **resp.json()}


# ---------------------------------------------------------------------------
# Auto-seed on project create
# ---------------------------------------------------------------------------


async def test_deadlines_seeded_on_create_with_dates(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Creating a project with both dates seeds 3 NL deadlines."""
    project = await _create_project_with_dates(client, org_user["access_token"])
    deadlines = await _list_deadlines(client, org_user["access_token"], project["id"])

    assert len(deadlines) == 3
    types = {d["deadline_type"] for d in deadlines}
    assert types == {"construction_notification", "information_obligation", "completion_notification"}

    for d in deadlines:
        assert d["status"] == "pending"
        assert d["due_date"] is not None
        assert d["met_at"] is None
        assert d["met_by_user_id"] is None


async def test_deadlines_seeded_without_dates_are_not_applicable(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Creating a project without dates → all deadlines are not_applicable."""
    project = await _create_project(client, org_user["access_token"], "No Dates")
    deadlines = await _list_deadlines(client, org_user["access_token"], project["id"])

    assert len(deadlines) == 3
    for d in deadlines:
        assert d["status"] == "not_applicable"
        assert d["due_date"] is None


async def test_deadlines_partial_dates(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Only planned_start_date → bouwmelding + informatieplicht pending,
    gereedmelding not_applicable."""
    project = await _create_project_with_dates(
        client, org_user["access_token"],
        planned_start_date="2026-09-01",
        delivery_date=None,
        name="Partial Dates",
    )
    deadlines = await _list_deadlines(client, org_user["access_token"], project["id"])

    by_type = {d["deadline_type"]: d for d in deadlines}
    assert by_type["construction_notification"]["status"] == "pending"
    assert by_type["information_obligation"]["status"] == "pending"
    assert by_type["completion_notification"]["status"] == "not_applicable"
    assert by_type["completion_notification"]["due_date"] is None


# ---------------------------------------------------------------------------
# Recompute on PATCH
# ---------------------------------------------------------------------------


async def test_recompute_on_date_change(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Changing planned_start_date recomputes bouwmelding + informatieplicht."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Recompute Test")
    deadlines_before = await _list_deadlines(client, token, project["id"])
    old_bouwmelding = next(d for d in deadlines_before if d["deadline_type"] == "construction_notification")

    # Change planned_start_date
    resp = await client.patch(
        f"/projects/{project['id']}",
        json={"planned_start_date": "2026-10-01"},
        headers=_auth(token),
    )
    assert resp.status_code == 200

    deadlines_after = await _list_deadlines(client, token, project["id"])
    new_bouwmelding = next(d for d in deadlines_after if d["deadline_type"] == "construction_notification")

    # Due date changed
    assert new_bouwmelding["due_date"] != old_bouwmelding["due_date"]
    # Row ID preserved (upsert)
    assert new_bouwmelding["id"] == old_bouwmelding["id"]


async def test_recompute_nulling_date_flips_to_not_applicable(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Setting planned_start_date to null → bouwmelding + informatieplicht become n.v.t."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Null Date")

    resp = await client.patch(
        f"/projects/{project['id']}",
        json={"planned_start_date": None},
        headers=_auth(token),
    )
    assert resp.status_code == 200

    deadlines = await _list_deadlines(client, token, project["id"])
    by_type = {d["deadline_type"]: d for d in deadlines}
    assert by_type["construction_notification"]["status"] == "not_applicable"
    assert by_type["information_obligation"]["status"] == "not_applicable"
    # gereedmelding untouched (still based on delivery_date)
    assert by_type["completion_notification"]["status"] == "pending"


async def test_recompute_met_deadline_resets_when_date_changes(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """If a deadline was met but the date changes, it resets to pending."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Met Reset")

    deadlines = await _list_deadlines(client, token, project["id"])
    bouwmelding = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    # Mark as met
    met_result = await _mark_met(client, token, project["id"], bouwmelding["id"])
    assert met_result["status"] == "met"

    # Change date → should reset
    resp = await client.patch(
        f"/projects/{project['id']}",
        json={"planned_start_date": "2026-11-01"},
        headers=_auth(token),
    )
    assert resp.status_code == 200

    updated = await _get_deadline(client, token, project["id"], bouwmelding["id"])
    assert updated["status"] == "pending"
    assert updated["met_at"] is None


async def test_recompute_met_deadline_preserved_when_date_unchanged(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """If a met deadline's date doesn't change on recompute, met is preserved."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Met Preserve")

    deadlines = await _list_deadlines(client, token, project["id"])
    bouwmelding = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    # Mark as met
    await _mark_met(client, token, project["id"], bouwmelding["id"])

    # Change delivery_date (not planned_start_date) — bouwmelding unchanged
    resp = await client.patch(
        f"/projects/{project['id']}",
        json={"delivery_date": "2027-06-01"},
        headers=_auth(token),
    )
    assert resp.status_code == 200

    updated = await _get_deadline(client, token, project["id"], bouwmelding["id"])
    assert updated["status"] == "met"


# ---------------------------------------------------------------------------
# CRUD — list / get / mark met
# ---------------------------------------------------------------------------


async def test_get_single_deadline(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Get Single")
    deadlines = await _list_deadlines(client, token, project["id"])

    dl = deadlines[0]
    fetched = await _get_deadline(client, token, project["id"], dl["id"])
    assert fetched["id"] == dl["id"]
    assert fetched["deadline_type"] == dl["deadline_type"]


async def test_mark_met_sets_fields(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Mark Met")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    result = await _mark_met(client, token, project["id"], dl["id"])
    assert result["status"] == "met"
    assert result["met_at"] is not None
    assert result["met_by_user_id"] == org_user["id"]


async def test_mark_met_idempotent(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Marking an already-met deadline is a no-op 200."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Idempotent")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    first = await _mark_met(client, token, project["id"], dl["id"])
    second = await _mark_met(client, token, project["id"], dl["id"])
    assert first["met_at"] == second["met_at"]
    assert second["status"] == "met"


async def test_mark_met_not_applicable_returns_409(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Cannot mark a not_applicable deadline as met."""
    token = org_user["access_token"]
    project = await _create_project(client, token, "No Dates 409")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = deadlines[0]  # all are not_applicable

    resp = await client.patch(
        f"/projects/{project['id']}/deadlines/{dl['id']}",
        json={},
        headers=_auth(token),
    )
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# is_overdue computation
# ---------------------------------------------------------------------------


async def test_is_overdue_for_past_due_pending(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """A pending deadline with due_date in the past is overdue."""
    token = org_user["access_token"]
    # Use a start date far in the past so bouwmelding due_date is also past
    project = await _create_project_with_dates(
        client, token,
        planned_start_date="2024-01-01",
        delivery_date="2024-06-01",
        name="Overdue Test",
    )
    deadlines = await _list_deadlines(client, token, project["id"])
    bouwmelding = next(d for d in deadlines if d["deadline_type"] == "construction_notification")
    assert bouwmelding["is_overdue"] is True


async def test_is_overdue_false_for_met(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """A met deadline is not overdue even if due_date is past."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(
        client, token,
        planned_start_date="2024-01-01",
        delivery_date="2024-06-01",
        name="Met Not Overdue",
    )
    deadlines = await _list_deadlines(client, token, project["id"])
    bouwmelding = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    result = await _mark_met(client, token, project["id"], bouwmelding["id"])
    assert result["is_overdue"] is False


async def test_is_overdue_false_for_not_applicable(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """A not_applicable deadline is never overdue."""
    token = org_user["access_token"]
    project = await _create_project(client, token, "NA Not Overdue")
    deadlines = await _list_deadlines(client, token, project["id"])
    for d in deadlines:
        assert d["is_overdue"] is False


# ---------------------------------------------------------------------------
# Permission gates
# ---------------------------------------------------------------------------


async def _set_member_role(
    client: AsyncClient, token: str, project_id: str, user_id: str, role: str,
) -> None:
    resp = await client.patch(
        f"/projects/{project_id}/members/{user_id}",
        json={"role": role},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text


async def test_viewer_can_read_deadlines(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    """Viewer role can list deadlines (read-only)."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Viewer Read")

    await _set_member_role(
        client, token, project["id"], same_org_user["id"], "viewer"
    )

    deadlines = await _list_deadlines(
        client, same_org_user["access_token"], project["id"]
    )
    assert len(deadlines) == 3


async def test_viewer_cannot_mark_met(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    """Viewer role cannot mark a deadline as met (403)."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Viewer Write")

    await _set_member_role(
        client, token, project["id"], same_org_user["id"], "viewer"
    )

    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    resp = await client.patch(
        f"/projects/{project['id']}/deadlines/{dl['id']}",
        json={},
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 403


async def test_editor_can_mark_met(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    """Editor role can mark a deadline as met."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Editor Met")

    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    resp = await client.patch(
        f"/projects/{project['id']}/deadlines/{dl['id']}",
        json={},
        headers=_auth(same_org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "met"


# ---------------------------------------------------------------------------
# RLS tenant isolation
# ---------------------------------------------------------------------------


async def test_rls_isolation_across_orgs(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    """Deadlines from org A are invisible to org B."""
    project = await _create_project_with_dates(
        client, org_user["access_token"], name="Org A Project"
    )

    resp = await client.get(
        f"/projects/{project['id']}/deadlines",
        headers=_auth(other_org_user["access_token"]),
    )
    # Project itself is 404 (RLS hides it) → deadlines endpoint returns 404
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Cascade on project delete
# ---------------------------------------------------------------------------


async def test_deadlines_cascade_on_project_delete(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Deleting a project cascades to its deadlines."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Cascade Test")
    deadlines = await _list_deadlines(client, token, project["id"])
    assert len(deadlines) == 3

    resp = await client.delete(
        f"/projects/{project['id']}", headers=_auth(token)
    )
    assert resp.status_code == 204

    # Attempting to list deadlines on deleted project → 404
    resp = await client.get(
        f"/projects/{project['id']}/deadlines", headers=_auth(token)
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 404 cases
# ---------------------------------------------------------------------------


async def test_get_nonexistent_deadline_returns_404(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="404 Test")
    from uuid import uuid4

    resp = await client.get(
        f"/projects/{project['id']}/deadlines/{uuid4()}",
        headers=_auth(token),
    )
    assert resp.status_code == 404
