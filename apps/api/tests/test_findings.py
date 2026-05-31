"""HTTP-level integration tests for Bevinding (Finding) CRUD.

Wkb MVP backlog #25 acceptance: findings are first-class, created manually,
editable as drafts, and promoting a draft to `open` requires a deadline and an
assignee. Role-gated writes; soft-delete; tenant isolation; audit trail.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import text

from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _add_member,
    _audit_rows,
    _auth,
    _create_model,
    _create_project,
)

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# A 22-char IFC GlobalId for element-link tests (#49).
ELEMENT_GLOBAL_ID = "3kF4p5c6m7N8o9P0q1rS2t"

_file_counter = 0


async def _create_ready_file(
    client: AsyncClient,
    fake: FakeStorage,
    token: str,
    project_id: str,
    model_id: str,
) -> str:
    """Create an IFC file through the two-phase upload. Returns file_id.

    Content varies per call (counter suffix appended after the STEP header) so
    several versions can be uploaded under one model without tripping the
    content-sha dedup — needed by the cross-version element tests.
    """
    global _file_counter
    _file_counter += 1
    content = VALID_IFC_HEADER + f"\n{_file_counter}".encode()
    sha = hashlib.sha256(content).hexdigest()
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": f"elem-{_file_counter}.ifc",
                "size_bytes": len(content),
                "content_type": "application/octet-stream",
                "content_sha256": sha,
            },
            headers=_auth(token),
        )
    ).json()
    fake.objects[init["storage_key"]] = content
    complete = await client.post(
        f"/projects/{project_id}/models/{model_id}/files/{init['file_id']}/complete",
        headers=_auth(token),
    )
    assert complete.status_code == 200, complete.text
    return init["file_id"]


def _payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "title": "Brandwerende doorvoer ontbreekt",
        "description": "Doorvoer in brandscheiding nabij meterkast niet afgewerkt.",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


async def test_create_finding_minimal(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "Brandwerende doorvoer ontbreekt"
    assert body["status"] == "draft"
    assert body["severity"] == "medium"
    assert body["project_id"] == project["id"]
    assert body["assignee_user_id"] is None
    assert body["deadline_date"] is None
    assert body["source_checklist_item_id"] is None
    assert body["created_by_user_id"] == org_user["id"]
    assert "id" in body and "created_at" in body and "updated_at" in body


async def test_create_finding_with_fields(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(severity="high", bbl_article_ref="4.51"),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["severity"] == "high"
    assert body["bbl_article_ref"] == "4.51"


async def test_create_finding_photo_ids_round_trips(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    # N5: photos attached while logging a finding round-trip through the JSONB
    # column. Bare UUID strings prove the field plumbing without real uploads.
    token = org_user["access_token"]
    project = await _create_project(client, token)
    photo_ids = [str(uuid4()), str(uuid4())]

    create = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(photo_ids=photo_ids),
        headers=_auth(token),
    )
    assert create.status_code == 201, create.text
    finding_id = create.json()["id"]
    assert create.json()["photo_ids"] == photo_ids

    got = await client.get(
        f"/projects/{project['id']}/findings/{finding_id}",
        headers=_auth(token),
    )
    assert got.status_code == 200, got.text
    assert got.json()["photo_ids"] == photo_ids

    replacement = [str(uuid4())]
    patched = await client.patch(
        f"/projects/{project['id']}/findings/{finding_id}",
        json={"photo_ids": replacement},
        headers=_auth(token),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["photo_ids"] == replacement


async def test_create_finding_invalid_severity_422(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(severity="catastrophic"),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_create_finding_title_required(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(title=""),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_create_finding_description_required(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(description=""),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_create_finding_writes_audit_log(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    rows = await _audit_rows(session_maker, "finding.created", resource_id=created["id"])
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# List / get
# ---------------------------------------------------------------------------


async def test_list_findings_empty(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/findings",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_findings_filter_by_status_and_severity(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    token = org_user["access_token"]
    await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(title="low-one", severity="low"),
        headers=_auth(token),
    )
    await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(title="high-one", severity="high"),
        headers=_auth(token),
    )

    by_sev = await client.get(
        f"/projects/{project['id']}/findings?severity=high",
        headers=_auth(token),
    )
    assert by_sev.status_code == 200
    assert [f["title"] for f in by_sev.json()] == ["high-one"]

    # All start as draft.
    by_status = await client.get(
        f"/projects/{project['id']}/findings?status_filter=draft",
        headers=_auth(token),
    )
    assert by_status.status_code == 200
    assert len(by_status.json()) == 2

    by_open = await client.get(
        f"/projects/{project['id']}/findings?status_filter=open",
        headers=_auth(token),
    )
    assert by_open.status_code == 200
    assert by_open.json() == []


async def test_list_findings_pagination_and_total_count(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    token = org_user["access_token"]
    for i in range(3):
        resp = await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(title=f"f-{i}"),
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text

    page1 = await client.get(
        f"/projects/{project['id']}/findings?limit=2",
        headers=_auth(token),
    )
    assert page1.status_code == 200, page1.text
    assert len(page1.json()) == 2
    assert page1.headers["X-Total-Count"] == "3"

    page2 = await client.get(
        f"/projects/{project['id']}/findings?limit=2&offset=2",
        headers=_auth(token),
    )
    assert page2.status_code == 200, page2.text
    assert len(page2.json()) == 1
    assert page2.headers["X-Total-Count"] == "3"

    # Pages are disjoint — offset actually advances the window.
    ids1 = {f["id"] for f in page1.json()}
    ids2 = {f["id"] for f in page2.json()}
    assert ids1.isdisjoint(ids2)

    # limit is bounded (le=200) — over-max is rejected by validation.
    too_big = await client.get(
        f"/projects/{project['id']}/findings?limit=201",
        headers=_auth(token),
    )
    assert too_big.status_code == 422


async def test_get_finding_404_cross_project(client: AsyncClient, org_user: dict[str, str]) -> None:
    project_a = await _create_project(client, org_user["access_token"], name="A")
    project_b = await _create_project(client, org_user["access_token"], name="B")
    finding = (
        await client.post(
            f"/projects/{project_a['id']}/findings",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    resp = await client.get(
        f"/projects/{project_b['id']}/findings/{finding['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_get_finding_404_unknown(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/findings/{uuid4()}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Patch / promote
# ---------------------------------------------------------------------------


async def test_update_finding_partial(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    resp = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"severity": "high", "description": "Aangepaste omschrijving."},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["severity"] == "high"
    assert body["description"] == "Aangepaste omschrijving."
    assert body["title"] == created["title"]
    assert body["status"] == "draft"


async def test_promote_requires_deadline_and_assignee(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    # status=open with neither deadline nor assignee → 422
    resp = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"status": "open"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "FINDING_PROMOTE_REQUIRES_DEADLINE_ASSIGNEE"

    # deadline only, still missing assignee → 422
    resp = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"status": "open", "deadline_date": "2026-08-01"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_promote_success_emits_notification(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={
            "status": "open",
            "deadline_date": "2026-08-01",
            "assignee_user_id": org_user["id"],
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "open"
    assert body["assignee_user_id"] == org_user["id"]
    assert body["deadline_date"] == "2026-08-01"

    notifs = await client.get("/notifications", headers=_auth(org_user["access_token"]))
    assert notifs.status_code == 200
    events = [n["event_type"] for n in notifs.json()["items"]]
    assert "finding_created" in events


async def test_promote_with_nonmember_assignee_422(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    resp = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={
            "status": "open",
            "deadline_date": "2026-08-01",
            "assignee_user_id": other_org_user["id"],
        },
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "ASSIGNEE_NOT_A_PROJECT_MEMBER"


# ---------------------------------------------------------------------------
# Resolution + verification lifecycle (#26/#27)
# ---------------------------------------------------------------------------

EVIDENCE_NOTE = "Doorvoer brandwerend afgekit en visueel gecontroleerd."


async def _promote_to_open(
    client: AsyncClient, token: str, project_id: str, finding_id: str, assignee_id: str
) -> None:
    resp = await client.patch(
        f"/projects/{project_id}/findings/{finding_id}",
        json={
            "status": "open",
            "deadline_date": "2026-08-01",
            "assignee_user_id": assignee_id,
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text


async def _resolve(client: AsyncClient, token: str, project_id: str, finding_id: str) -> None:
    resp = await client.patch(
        f"/projects/{project_id}/findings/{finding_id}",
        json={
            "status": "resolved",
            "resolution_note": EVIDENCE_NOTE,
            "resolution_evidence_ids": [str(uuid4())],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text


async def test_resolve_requires_note_and_evidence(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    await _promote_to_open(client, token, project["id"], created["id"], org_user["id"])

    bare = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"status": "resolved"},
        headers=_auth(token),
    )
    assert bare.status_code == 422
    assert bare.json()["detail"] == "FINDING_RESOLVE_REQUIRES_EVIDENCE"

    note_only = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"status": "resolved", "resolution_note": EVIDENCE_NOTE},
        headers=_auth(token),
    )
    assert note_only.status_code == 422

    evidence_only = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"status": "resolved", "resolution_evidence_ids": [str(uuid4())]},
        headers=_auth(token),
    )
    assert evidence_only.status_code == 422


async def test_resolve_with_evidence_succeeds_and_notifies(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    await _promote_to_open(client, token, project["id"], created["id"], org_user["id"])

    evidence = [str(uuid4())]
    resolved = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={
            "status": "resolved",
            "resolution_note": EVIDENCE_NOTE,
            "resolution_evidence_ids": evidence,
        },
        headers=_auth(token),
    )
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["status"] == "resolved"
    assert body["resolution_note"] == EVIDENCE_NOTE
    assert body["resolution_evidence_ids"] == evidence

    notifs = await client.get("/notifications", headers=_auth(token))
    events = [n["event_type"] for n in notifs.json()["items"]]
    assert "finding_resolved" in events


async def test_resolve_writes_audit(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    await _promote_to_open(client, token, project["id"], created["id"], org_user["id"])
    await _resolve(client, token, project["id"], created["id"])

    rows = await _audit_rows(session_maker, "finding.resolved", resource_id=created["id"])
    assert len(rows) == 1


async def test_illegal_transition_open_to_verified(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    await _promote_to_open(client, token, project["id"], created["id"], org_user["id"])

    resp = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"status": "verified"},
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "FINDING_ILLEGAL_TRANSITION"


async def test_illegal_transition_draft_to_resolved(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    resp = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={
            "status": "resolved",
            "resolution_note": EVIDENCE_NOTE,
            "resolution_evidence_ids": [str(uuid4())],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "FINDING_ILLEGAL_TRANSITION"


async def test_resolved_can_be_reworked_to_in_progress(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    # Inspector rejects a resolution: resolved -> in_progress (rework). Going
    # out of resolved must not trip the evidence gate.
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], same_org_non_admin_user["id"], "inspector")
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    await _promote_to_open(client, token, project["id"], created["id"], org_user["id"])
    await _resolve(client, token, project["id"], created["id"])

    rework = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"status": "in_progress"},
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert rework.status_code == 200, rework.text
    assert rework.json()["status"] == "in_progress"


async def test_contractor_cannot_verify(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], same_org_non_admin_user["id"], "contractor")
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    await _promote_to_open(client, token, project["id"], created["id"], org_user["id"])
    await _resolve(client, token, project["id"], created["id"])

    resp = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"status": "verified"},
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "FINDING_VERIFY_REQUIRES_INSPECTOR"


async def test_inspector_can_verify(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], same_org_non_admin_user["id"], "inspector")
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    await _promote_to_open(client, token, project["id"], created["id"], org_user["id"])
    await _resolve(client, token, project["id"], created["id"])

    resp = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"status": "verified"},
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "verified"

    rows = await _audit_rows(session_maker, "finding.verified", resource_id=created["id"])
    assert len(rows) == 1


async def test_verified_is_terminal_no_revert(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], same_org_non_admin_user["id"], "inspector")
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    await _promote_to_open(client, token, project["id"], created["id"], org_user["id"])
    await _resolve(client, token, project["id"], created["id"])
    verified = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"status": "verified"},
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert verified.status_code == 200, verified.text

    revert = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"status": "in_progress"},
        headers=_auth(token),
    )
    assert revert.status_code == 422
    assert revert.json()["detail"] == "FINDING_ILLEGAL_TRANSITION"


# ---------------------------------------------------------------------------
# History timeline (#26) — GET /findings/{id}/history
# ---------------------------------------------------------------------------


async def test_finding_history_orders_chronologically(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    await _promote_to_open(client, token, project["id"], created["id"], org_user["id"])
    await _resolve(client, token, project["id"], created["id"])

    resp = await client.get(
        f"/projects/{project['id']}/findings/{created['id']}/history",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    entries = resp.json()
    # Oldest first: created -> promoted -> resolved.
    assert [e["action"] for e in entries] == [
        "finding.created",
        "finding.promoted",
        "finding.resolved",
    ]
    assert entries[0]["from_status"] is None
    assert entries[0]["to_status"] == "draft"
    assert entries[1]["from_status"] == "draft"
    assert entries[1]["to_status"] == "open"
    assert entries[2]["from_status"] == "open"
    assert entries[2]["to_status"] == "resolved"
    # Actor is resolved from public.users on every entry.
    for entry in entries:
        assert entry["actor_user_id"] == org_user["id"]
        assert entry["actor_email"]


async def test_finding_history_attributes_each_actor(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    other = same_org_non_admin_user
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], other["id"], "contractor")
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    await _promote_to_open(client, token, project["id"], created["id"], org_user["id"])
    # A different member resolves it — history must attribute each entry.
    await _resolve(client, other["access_token"], project["id"], created["id"])

    entries = (
        await client.get(
            f"/projects/{project['id']}/findings/{created['id']}/history",
            headers=_auth(token),
        )
    ).json()
    by_action = {e["action"]: e for e in entries}
    assert by_action["finding.promoted"]["actor_user_id"] == org_user["id"]
    assert by_action["finding.resolved"]["actor_user_id"] == other["id"]


async def test_finding_history_unknown_finding_404(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    resp = await client.get(
        f"/projects/{project['id']}/findings/{uuid4()}/history",
        headers=_auth(token),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "FINDING_NOT_FOUND"


async def test_finding_history_non_member_404(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    created = (
        await client.post(
            f"/projects/{project['id']}/findings", json=_payload(), headers=_auth(token)
        )
    ).json()
    resp = await client.get(
        f"/projects/{project['id']}/findings/{created['id']}/history",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delete (soft)
# ---------------------------------------------------------------------------


async def test_delete_finding_soft_then_hidden(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.delete(
        f"/projects/{project['id']}/findings/{created['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204

    follow = await client.get(
        f"/projects/{project['id']}/findings/{created['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert follow.status_code == 404

    listing = await client.get(
        f"/projects/{project['id']}/findings",
        headers=_auth(org_user["access_token"]),
    )
    assert listing.json() == []


# ---------------------------------------------------------------------------
# Membership + role enforcement
# ---------------------------------------------------------------------------


async def test_finding_requires_membership_for_get(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/findings",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_finding_viewer_can_read_not_write(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "viewer",
    )
    created = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    list_resp = await client.get(
        f"/projects/{project['id']}/findings",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    post_resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(title="viewer-attempt"),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert post_resp.status_code == 403

    del_resp = await client.delete(
        f"/projects/{project['id']}/findings/{created['id']}",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert del_resp.status_code == 403


async def test_finding_inspector_can_create(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "inspector",
    )
    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(title="inspector-created"),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text


async def test_finding_contractor_can_create_and_update(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    # Aannemer-first (N5): the contractor logs findings manually from the KB's
    # report and works them through resolution. Create + update, no delete.
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "contractor",
    )

    create_resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(title="contractor-created"),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    assert created["created_by_user_id"] == same_org_non_admin_user["id"]

    update_resp = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"description": "Contractor noteert voortgang."},
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert update_resp.status_code == 200, update_resp.text


async def test_finding_rejected_when_project_archived(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    arch = await client.post(
        f"/projects/{project['id']}/archive",
        headers=_auth(org_user["access_token"]),
    )
    assert arch.status_code == 200

    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "PROJECT_ARCHIVED"


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------


async def test_finding_invisible_across_orgs(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    project_a = await _create_project(client, org_user["access_token"], name="AlphaP")
    await client.post(
        f"/projects/{project_a['id']}/findings",
        json=_payload(title="alpha-only"),
        headers=_auth(org_user["access_token"]),
    )
    resp = await client.get(
        f"/projects/{project_a['id']}/findings",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_finding_cascade_on_project_hard_delete(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    async with session_maker() as session:
        await session.execute(
            text(f'SET search_path TO "org_{org_user["organization_id"].replace("-", "")}", public')
        )
        await session.execute(
            text("DELETE FROM projects WHERE id = :pid"),
            {"pid": project["id"]},
        )
        await session.commit()
        rows = (
            await session.execute(
                text("SELECT id FROM findings WHERE id = :fid"),
                {"fid": created["id"]},
            )
        ).all()
    assert rows == []


# ---------------------------------------------------------------------------
# Element linking (#49)
# ---------------------------------------------------------------------------


async def test_create_finding_with_element_link(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    org_user: dict[str, str],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    model = await _create_model(client, token, project["id"])
    file_id = await _create_ready_file(client, fake, token, project["id"], model["id"])

    resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(linked_file_id=file_id, linked_element_global_id=ELEMENT_GLOBAL_ID),
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["linked_file_id"] == file_id
    assert body["linked_element_global_id"] == ELEMENT_GLOBAL_ID


async def test_patch_finding_link_then_unlink(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    org_user: dict[str, str],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    model = await _create_model(client, token, project["id"])
    file_id = await _create_ready_file(client, fake, token, project["id"], model["id"])

    created = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(),
            headers=_auth(token),
        )
    ).json()
    assert created["linked_file_id"] is None
    assert created["linked_element_global_id"] is None

    # Link.
    linked = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"linked_file_id": file_id, "linked_element_global_id": ELEMENT_GLOBAL_ID},
        headers=_auth(token),
    )
    assert linked.status_code == 200, linked.text
    assert linked.json()["linked_element_global_id"] == ELEMENT_GLOBAL_ID

    # Unlink (explicit nulls).
    unlinked = await client.patch(
        f"/projects/{project['id']}/findings/{created['id']}",
        json={"linked_file_id": None, "linked_element_global_id": None},
        headers=_auth(token),
    )
    assert unlinked.status_code == 200, unlinked.text
    assert unlinked.json()["linked_file_id"] is None
    assert unlinked.json()["linked_element_global_id"] is None


async def test_list_findings_filter_by_element(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    org_user: dict[str, str],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    model = await _create_model(client, token, project["id"])
    file_id = await _create_ready_file(client, fake, token, project["id"], model["id"])

    await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(
            title="linked-one",
            linked_file_id=file_id,
            linked_element_global_id=ELEMENT_GLOBAL_ID,
        ),
        headers=_auth(token),
    )
    await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(title="unlinked-one"),
        headers=_auth(token),
    )

    by_elem = await client.get(
        f"/projects/{project['id']}/findings"
        f"?linked_file_id={file_id}&linked_element_global_id={ELEMENT_GLOBAL_ID}",
        headers=_auth(token),
    )
    assert by_elem.status_code == 200, by_elem.text
    assert [f["title"] for f in by_elem.json()] == ["linked-one"]


async def test_list_findings_filter_unlinked(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    org_user: dict[str, str],
) -> None:
    """`?unlinked=true` returns only findings with no linked element — the
    project-level set shown in the viewer inspector when nothing is selected
    (mirrors the attachments `unlinked` filter)."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    model = await _create_model(client, token, project["id"])
    file_id = await _create_ready_file(client, fake, token, project["id"], model["id"])

    await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(
            title="linked-one",
            linked_file_id=file_id,
            linked_element_global_id=ELEMENT_GLOBAL_ID,
        ),
        headers=_auth(token),
    )
    await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(title="project-level-one"),
        headers=_auth(token),
    )

    unlinked = await client.get(
        f"/projects/{project['id']}/findings?unlinked=true",
        headers=_auth(token),
    )
    assert unlinked.status_code == 200, unlinked.text
    assert [f["title"] for f in unlinked.json()] == ["project-level-one"]


async def test_finding_follows_element_across_versions(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    org_user: dict[str, str],
) -> None:
    """A finding attached to an element on file v1 is found by the
    version-independent (model + GlobalId) query, so it carries over when a new
    version of the model is uploaded (#N9). `linked_file_id` stays as the
    "raised on this version" provenance and no longer scopes the lookup."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    model = await _create_model(client, token, project["id"])
    file_v1 = await _create_ready_file(client, fake, token, project["id"], model["id"])
    file_v2 = await _create_ready_file(client, fake, token, project["id"], model["id"])

    created = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(
                linked_model_id=model["id"],
                linked_file_id=file_v1,
                linked_element_global_id=ELEMENT_GLOBAL_ID,
            ),
            headers=_auth(token),
        )
    ).json()
    assert created["linked_model_id"] == model["id"]
    assert created["linked_file_id"] == file_v1

    # The viewer queries by model + GlobalId — returns the v1 finding regardless
    # of which file version is open.
    by_model = await client.get(
        f"/projects/{project['id']}/findings"
        f"?linked_model_id={model['id']}&linked_element_global_id={ELEMENT_GLOBAL_ID}",
        headers=_auth(token),
    )
    assert by_model.status_code == 200, by_model.text
    assert [f["id"] for f in by_model.json()] == [created["id"]]

    # The old file-pinned query against v2 would NOT surface it — proving the
    # carry-over comes from the model-level identity, not the file link.
    by_v2_file = await client.get(
        f"/projects/{project['id']}/findings"
        f"?linked_file_id={file_v2}&linked_element_global_id={ELEMENT_GLOBAL_ID}",
        headers=_auth(token),
    )
    assert by_v2_file.status_code == 200, by_v2_file.text
    assert by_v2_file.json() == []
