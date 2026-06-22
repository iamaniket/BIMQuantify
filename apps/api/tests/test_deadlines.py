"""Integration tests for deadline tracker (backlog #28).

Covers: auto-seed on project create, recompute on PATCH, CRUD endpoints,
is_overdue computation, mark-as-met/filing, readiness checks, permission
gates, RLS isolation, audit logging.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.conftest import VALID_IFC_HEADER, _auth, _create_model, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from tests.conftest import FakeStorage


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


async def test_list_deadlines_pagination_and_total_count(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    # A project with both dates auto-seeds exactly 3 deadlines.
    project = await _create_project_with_dates(client, token, name="Paginated")

    page1 = await client.get(
        f"/projects/{project['id']}/deadlines?limit=2",
        headers=_auth(token),
    )
    assert page1.status_code == 200, page1.text
    assert len(page1.json()) == 2
    assert page1.headers["X-Total-Count"] == "3"

    page2 = await client.get(
        f"/projects/{project['id']}/deadlines?limit=2&offset=2",
        headers=_auth(token),
    )
    assert page2.status_code == 200, page2.text
    assert len(page2.json()) == 1

    too_big = await client.get(
        f"/projects/{project['id']}/deadlines?limit=201",
        headers=_auth(token),
    )
    assert too_big.status_code == 422


# ---------------------------------------------------------------------------
# Filing flow (N4) — PATCH with body, readiness endpoint, audit
# ---------------------------------------------------------------------------


async def _file_deadline(
    client: AsyncClient,
    token: str,
    project_id: str,
    deadline_id: str,
    *,
    reference_number: str | None = None,
    filing_notes: str | None = None,
) -> dict:
    body: dict[str, object] = {}
    if reference_number is not None:
        body["reference_number"] = reference_number
    if filing_notes is not None:
        body["filing_notes"] = filing_notes
    resp = await client.patch(
        f"/projects/{project_id}/deadlines/{deadline_id}",
        json=body,
        headers=_auth(token),
    )
    return resp.json() if resp.status_code == 200 else {"_status": resp.status_code, **resp.json()}


async def _get_readiness(
    client: AsyncClient, token: str, project_id: str, deadline_id: str
) -> dict:
    resp = await client.get(
        f"/projects/{project_id}/deadlines/{deadline_id}/readiness",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_file_deadline_with_reference_number(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Filing a deadline with reference number and notes persists all fields."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="File Ref")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    result = await _file_deadline(
        client, token, project["id"], dl["id"],
        reference_number="OLO-2026-12345",
        filing_notes="Filed via Omgevingsloket",
    )

    assert result["status"] == "met"
    assert result["reference_number"] == "OLO-2026-12345"
    assert result["filing_notes"] == "Filed via Omgevingsloket"
    assert result["filed_at"] is not None
    assert result["met_at"] is not None
    assert result["met_by_user_id"] == org_user["id"]


async def test_file_deadline_empty_body_backward_compat(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Empty body still works — backward compatible with old callers."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Empty Body")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    result = await _mark_met(client, token, project["id"], dl["id"])
    assert result["status"] == "met"
    assert result["filed_at"] is not None
    assert result["reference_number"] is None
    assert result["filing_notes"] is None


async def test_file_deadline_idempotent_preserves_filing_data(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Re-filing an already-met deadline is a no-op — original data preserved."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Idempotent File")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    first = await _file_deadline(
        client, token, project["id"], dl["id"],
        reference_number="OLO-FIRST",
    )
    second = await _file_deadline(
        client, token, project["id"], dl["id"],
        reference_number="OLO-SECOND",
    )

    assert second["reference_number"] == "OLO-FIRST"
    assert second["met_at"] == first["met_at"]


async def test_file_deadline_not_applicable_returns_409(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Cannot file a not_applicable deadline."""
    token = org_user["access_token"]
    project = await _create_project(client, token, "NA File 409")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = deadlines[0]

    resp = await client.patch(
        f"/projects/{project['id']}/deadlines/{dl['id']}",
        json={"reference_number": "OLO-X"},
        headers=_auth(token),
    )
    assert resp.status_code == 409


async def test_file_deadline_creates_audit_record(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Filing a deadline creates an audit log entry with action 'deadline.filed'."""
    from sqlalchemy import select, text

    from bimstitch_api.models.audit_log import AuditLog

    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Audit Test")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    await _file_deadline(
        client, token, project["id"], dl["id"],
        reference_number="OLO-AUDIT-001",
    )

    async with session_maker() as session:
        from uuid import UUID

        from bimstitch_api.tenancy import schema_name_for

        org_id = UUID(org_user["organization_id"])
        schema = schema_name_for(org_id)
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))

        row = (
            await session.execute(
                select(AuditLog)
                .where(AuditLog.action == "deadline.filed")
                .order_by(AuditLog.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    assert row is not None
    assert row.resource_type == "deadline"
    assert str(row.resource_id) == dl["id"]
    assert row.after is not None
    assert row.after["reference_number"] == "OLO-AUDIT-001"
    assert row.after["status"] == "met"


# ---------------------------------------------------------------------------
# Readiness checks
# ---------------------------------------------------------------------------


async def test_readiness_informatieplicht_always_ready(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Information obligation has no required dossier codes → always ready."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Info Ready")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "information_obligation")

    readiness = await _get_readiness(client, token, project["id"], dl["id"])
    assert readiness["is_ready"] is True
    assert readiness["items"] == []
    assert readiness["total_required"] == 0


async def test_readiness_bouwmelding_missing_docs(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Bouwmelding with no uploads → all required items unfulfilled."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Bouw Missing")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    readiness = await _get_readiness(client, token, project["id"], dl["id"])
    assert readiness["is_ready"] is False
    assert readiness["ready_count"] == 0
    assert readiness["total_required"] > 0
    assert len(readiness["items"]) == 5  # 5 required dossier codes for bouwmelding

    for item in readiness["items"]:
        assert item["fulfilled"] is False
        assert item["count"] == 0


async def test_readiness_gereedmelding_has_all_codes(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Gereedmelding readiness has 11 items (full dossier)."""
    token = org_user["access_token"]
    project = await _create_project_with_dates(client, token, name="Gereed Full")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "completion_notification")

    readiness = await _get_readiness(client, token, project["id"], dl["id"])
    assert len(readiness["items"]) == 11


async def test_readiness_drawings_requires_viewable_model(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Drawings (model-backed) is fulfilled only by a viewable/processed model.

    A model whose only file is still extracting does not count; once its IFC
    extraction succeeds the drawings dossier code flips to fulfilled. Drawings
    no longer reads attachments at all.
    """
    client, fake = fake_storage_client
    token = org_user["access_token"]

    project = await _create_project_with_dates(client, token, name="Drawings Model")
    deadlines = await _list_deadlines(client, token, project["id"])
    dl = next(d for d in deadlines if d["deadline_type"] == "construction_notification")

    def _drawings(readiness: dict) -> dict:
        return next(i for i in readiness["items"] if i["code"] == "drawings")

    # 1) No model → drawings missing.
    readiness = await _get_readiness(client, token, project["id"], dl["id"])
    assert _drawings(readiness)["fulfilled"] is False
    assert _drawings(readiness)["count"] == 0

    # 2) A model whose IFC was just completed (extraction still queued) is not
    #    yet viewable → drawings stays missing.
    model = await _create_model(client, token, project["id"], name="m-drawings")
    init = (
        await client.post(
            f"/projects/{project['id']}/models/{model['id']}/files/initiate",
            json={
                "filename": "drawings.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": "1" * 64,
            },
            headers=_auth(token),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    complete = await client.post(
        f"/projects/{project['id']}/models/{model['id']}/files/{init['file_id']}/complete",
        headers=_auth(token),
    )
    assert complete.status_code == 200, complete.text

    readiness = await _get_readiness(client, token, project["id"], dl["id"])
    assert _drawings(readiness)["fulfilled"] is False

    # 3) Extraction succeeds → the model is viewable → drawings fulfilled.
    succeeded = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": init["file_id"],
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": f"projects/{project['id']}/{init['file_id']}.frag",
            "metadata_key": f"projects/{project['id']}/{init['file_id']}.metadata.json",
            "properties_key": f"projects/{project['id']}/{init['file_id']}.properties.json",
        },
        headers={"Authorization": "Bearer dev-shared-secret-change-me"},
    )
    assert succeeded.status_code == 200, succeeded.text

    readiness = await _get_readiness(client, token, project["id"], dl["id"])
    item = _drawings(readiness)
    assert item["fulfilled"] is True
    assert item["count"] == 1


async def test_readiness_404_wrong_project(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    """Cross-org readiness check returns 404."""
    project = await _create_project_with_dates(
        client, org_user["access_token"], name="Cross Org Readiness"
    )
    deadlines = await _list_deadlines(client, org_user["access_token"], project["id"])
    dl = deadlines[0]

    resp = await client.get(
        f"/projects/{project['id']}/deadlines/{dl['id']}/readiness",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404
