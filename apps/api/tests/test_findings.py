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


async def _create_ready_file(
    client: AsyncClient,
    fake: FakeStorage,
    token: str,
    project_id: str,
    model_id: str,
) -> str:
    """Create an IFC file through the two-phase upload. Returns file_id."""
    sha = hashlib.sha256(VALID_IFC_HEADER).hexdigest()
    init = (
        await client.post(
            f"/projects/{project_id}/models/{model_id}/files/initiate",
            json={
                "filename": "elem.ifc",
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": sha,
            },
            headers=_auth(token),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
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


async def test_create_finding_with_fields(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
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


async def test_create_finding_title_required(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
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


async def test_get_finding_404_cross_project(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
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


async def test_finding_contractor_cannot_create_but_can_update(
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
        "contractor",
    )
    created = (
        await client.post(
            f"/projects/{project['id']}/findings",
            json=_payload(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    create_resp = await client.post(
        f"/projects/{project['id']}/findings",
        json=_payload(title="contractor-attempt"),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert create_resp.status_code == 403

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
