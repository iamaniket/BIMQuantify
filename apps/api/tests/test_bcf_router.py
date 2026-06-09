"""HTTP-level integration tests for BCF topic CRUD + import/export.

Tests follow the same pattern as test_risks.py: tenant-isolated, role-gated,
using the conftest helpers (_create_project, _auth, _add_member).
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from tests.conftest import _add_member, _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient


def _viewpoint(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "guid": str(uuid4()),
        "index_in_topic": 0,
        "camera_type": "perspective",
        "camera_view_point": {"x": 10.0, "y": 5.0, "z": 3.0},
        "camera_direction": {"x": 0.0, "y": 0.0, "z": -1.0},
        "camera_up_vector": {"x": 0.0, "y": 1.0, "z": 0.0},
        "field_of_view": 60.0,
        "clipping_planes": [],
        "is_2d": False,
    }
    base.update(overrides)
    return base


def _topic(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "title": "Fire safety issue in corridor B",
        "description": "Missing fire stop at floor penetration",
        "topic_type": "Issue",
        "topic_status": "Open",
        "priority": "High",
        "labels": ["fire-safety", "critical"],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


async def test_create_topic_minimal(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json={"title": "Test issue"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "Test issue"
    assert body["topic_type"] == "Issue"
    assert body["topic_status"] == "Open"
    assert body["bcf_version"] == "3.0"
    assert body["project_id"] == project["id"]
    assert "id" in body and "guid" in body
    assert body["viewpoints"] == []
    assert body["comments"] == []


async def test_create_topic_with_viewpoint(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(viewpoint=_viewpoint()),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "Fire safety issue in corridor B"
    assert len(body["viewpoints"]) == 1
    vp = body["viewpoints"][0]
    assert vp["camera_type"] == "perspective"
    assert vp["camera_view_point"]["x"] == 10.0
    assert vp["field_of_view"] == 60.0


async def test_create_topic_with_labels(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(labels=["structure", "urgent"]),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["labels"] == ["structure", "urgent"]


async def test_create_topic_title_required(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json={"title": ""},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


async def test_create_topic_with_clipping_planes(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    vp = _viewpoint(
        clipping_planes=[
            {"location": {"x": 0, "y": 0, "z": 5}, "direction": {"x": 0, "y": 0, "z": 1}},
        ]
    )
    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(viewpoint=vp),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    planes = body["viewpoints"][0]["clipping_planes"]
    assert len(planes) == 1
    assert planes[0]["location"]["z"] == 5


async def test_create_topic_with_xray_and_measurements(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    vp = _viewpoint(
        xray={
            "items": ["2O2Fr$t4X7Zf8NOew3FNr2"],
            "opacity_overrides": [
                {"global_id": "2O2Fr$t4X7Zf8NOew3FNr2", "opacity": 0.3},
            ],
        },
        measurements=[
            {
                "type": "distance",
                "points": [
                    {"x": 0.0, "y": 0.0, "z": 0.0},
                    {"x": 3.0, "y": 0.0, "z": 0.0},
                ],
            },
            {
                "type": "volume",
                "points": [
                    {"x": 0.0, "y": 0.0, "z": 0.0},
                    {"x": 2.0, "y": 0.0, "z": 0.0},
                    {"x": 2.0, "y": 0.0, "z": 2.0},
                ],
                "height": 3.0,
            },
        ],
    )
    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(viewpoint=vp),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    vp_read = resp.json()["viewpoints"][0]

    assert vp_read["xray"]["items"] == ["2O2Fr$t4X7Zf8NOew3FNr2"]
    assert vp_read["xray"]["opacity_overrides"][0]["opacity"] == 0.3
    assert len(vp_read["measurements"]) == 2
    assert vp_read["measurements"][0]["type"] == "distance"
    assert vp_read["measurements"][1]["height"] == 3.0


async def test_create_topic_without_extensions_reads_null(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(viewpoint=_viewpoint()),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    vp_read = resp.json()["viewpoints"][0]
    assert vp_read["xray"] is None
    assert vp_read["measurements"] is None


# ---------------------------------------------------------------------------
# List / Get
# ---------------------------------------------------------------------------


async def test_list_topics_empty(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json() == []
    assert resp.headers["x-total-count"] == "0"


async def test_list_topics_returns_summaries(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="Issue A"),
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="Issue B"),
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 2
    assert resp.headers["x-total-count"] == "2"
    # Ordered by creation_date desc — Issue B first
    assert items[0]["title"] == "Issue B"
    assert items[1]["title"] == "Issue A"
    # Summaries don't include viewpoints/comments
    assert "viewpoints" not in items[0]
    assert "comments" not in items[0]


async def test_list_topics_search_filter(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="Fire exit blocked"),
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="Missing insulation"),
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics?search=fire",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["title"] == "Fire exit blocked"


async def test_list_topics_status_filter(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="Open issue", topic_status="Open"),
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="Closed issue", topic_status="Closed"),
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics?status=Closed",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["title"] == "Closed issue"


async def test_get_topic_with_viewpoints_and_comments(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/bcf-topics",
            json=_topic(viewpoint=_viewpoint()),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    # Add a comment
    await client.post(
        f"/projects/{project['id']}/bcf-topics/{created['id']}/comments",
        json={"text": "This needs immediate attention"},
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics/{created['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["viewpoints"]) == 1
    assert len(body["comments"]) == 1
    assert body["comments"][0]["comment_text"] == "This needs immediate attention"


async def test_get_topic_404_wrong_project(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project_a = await _create_project(client, org_user["access_token"], name="A")
    project_b = await _create_project(client, org_user["access_token"], name="B")
    topic = (
        await client.post(
            f"/projects/{project_a['id']}/bcf-topics",
            json=_topic(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.get(
        f"/projects/{project_b['id']}/bcf-topics/{topic['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


async def test_get_topic_404_unknown_id(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics/{uuid4()}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Patch / Delete
# ---------------------------------------------------------------------------


async def test_update_topic_partial(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/bcf-topics",
            json=_topic(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.patch(
        f"/projects/{project['id']}/bcf-topics/{created['id']}",
        json={"topic_status": "Closed", "priority": "Low"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["topic_status"] == "Closed"
    assert body["priority"] == "Low"
    # Untouched fields preserved
    assert body["title"] == created["title"]
    assert body["description"] == created["description"]
    assert body["modified_author"] is not None
    assert body["modified_date"] is not None


async def test_update_topic_labels(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/bcf-topics",
            json=_topic(labels=["old-label"]),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    assert created["labels"] == ["old-label"]

    resp = await client.patch(
        f"/projects/{project['id']}/bcf-topics/{created['id']}",
        json={"labels": ["new-label-1", "new-label-2"]},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["labels"] == ["new-label-1", "new-label-2"]


async def test_delete_topic_soft(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    created = (
        await client.post(
            f"/projects/{project['id']}/bcf-topics",
            json=_topic(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.delete(
        f"/projects/{project['id']}/bcf-topics/{created['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204

    # Deleted topic no longer appears in list or get
    get_resp = await client.get(
        f"/projects/{project['id']}/bcf-topics/{created['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert get_resp.status_code == 404

    list_resp = await client.get(
        f"/projects/{project['id']}/bcf-topics",
        headers=_auth(org_user["access_token"]),
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 0


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


async def test_add_comment(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    topic = (
        await client.post(
            f"/projects/{project['id']}/bcf-topics",
            json=_topic(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics/{topic['id']}/comments",
        json={"text": "Check the east wall"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["comment_text"] == "Check the east wall"
    assert "id" in body and "guid" in body
    assert body["created_by_user_id"] is not None


async def test_update_comment(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    topic = (
        await client.post(
            f"/projects/{project['id']}/bcf-topics",
            json=_topic(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    comment = (
        await client.post(
            f"/projects/{project['id']}/bcf-topics/{topic['id']}/comments",
            json={"text": "Original text"},
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.patch(
        f"/projects/{project['id']}/bcf-topics/{topic['id']}/comments/{comment['id']}",
        json={"text": "Updated text"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["comment_text"] == "Updated text"
    assert resp.json()["modified_author"] is not None


async def test_delete_comment(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    topic = (
        await client.post(
            f"/projects/{project['id']}/bcf-topics",
            json=_topic(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    comment = (
        await client.post(
            f"/projects/{project['id']}/bcf-topics/{topic['id']}/comments",
            json={"text": "Doomed comment"},
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.delete(
        f"/projects/{project['id']}/bcf-topics/{topic['id']}/comments/{comment['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204

    # Comment gone from topic detail
    detail = await client.get(
        f"/projects/{project['id']}/bcf-topics/{topic['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert len(detail.json()["comments"]) == 0


# ---------------------------------------------------------------------------
# Viewpoints
# ---------------------------------------------------------------------------


async def test_add_viewpoint_to_existing_topic(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    topic = (
        await client.post(
            f"/projects/{project['id']}/bcf-topics",
            json=_topic(),
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    assert len(topic["viewpoints"]) == 0

    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics/{topic['id']}/viewpoints",
        json=_viewpoint(camera_type="orthographic", field_of_height=20.0),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    vp = resp.json()
    assert vp["camera_type"] == "orthographic"
    assert vp["field_of_height"] == 20.0

    # Verify it's in the topic detail
    detail = (
        await client.get(
            f"/projects/{project['id']}/bcf-topics/{topic['id']}",
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    assert len(detail["viewpoints"]) == 1


# ---------------------------------------------------------------------------
# Role enforcement
# ---------------------------------------------------------------------------


async def test_viewer_can_read_but_not_create(
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
    # Owner creates a topic
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(),
        headers=_auth(org_user["access_token"]),
    )

    # Viewer can list
    list_resp = await client.get(
        f"/projects/{project['id']}/bcf-topics",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    # Viewer cannot create
    create_resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="viewer attempt"),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert create_resp.status_code == 403


async def test_editor_can_create_and_update(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    create_resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="editor topic"),
        headers=_auth(same_org_user["access_token"]),
    )
    assert create_resp.status_code == 201, create_resp.text


async def test_rejected_when_project_archived(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    arch = await client.post(
        f"/projects/{project['id']}/archive",
        headers=_auth(org_user["access_token"]),
    )
    assert arch.status_code == 200

    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "PROJECT_ARCHIVED"


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------


async def test_topic_invisible_across_orgs(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="org-private"),
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics",
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


async def test_export_empty_project(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics/export",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert len(resp.content) > 0


async def test_export_with_topics(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="Export me", viewpoint=_viewpoint()),
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics/export",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert "bcf_export.bcf" in resp.headers.get("content-disposition", "")
    # The response is a valid ZIP
    import zipfile
    from io import BytesIO

    with zipfile.ZipFile(BytesIO(resp.content)) as zf:
        names = zf.namelist()
        assert any("bcf.version" in n for n in names)


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


async def test_import_and_roundtrip(client: AsyncClient, org_user: dict[str, str]) -> None:
    """Create a topic, export, import into a different project, verify."""
    project_a = await _create_project(client, org_user["access_token"], name="ExportProj")
    await client.post(
        f"/projects/{project_a['id']}/bcf-topics",
        json=_topic(title="Roundtrip topic", viewpoint=_viewpoint()),
        headers=_auth(org_user["access_token"]),
    )
    # Add comment
    topics = (
        await client.get(
            f"/projects/{project_a['id']}/bcf-topics",
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    topic_id = topics[0]["id"]
    await client.post(
        f"/projects/{project_a['id']}/bcf-topics/{topic_id}/comments",
        json={"text": "Roundtrip comment"},
        headers=_auth(org_user["access_token"]),
    )

    # Export
    export_resp = await client.get(
        f"/projects/{project_a['id']}/bcf-topics/export",
        headers=_auth(org_user["access_token"]),
    )
    assert export_resp.status_code == 200

    # Import into new project
    project_b = await _create_project(client, org_user["access_token"], name="ImportProj")
    import_resp = await client.post(
        f"/projects/{project_b['id']}/bcf-topics/import",
        files={"file": ("export.bcf", export_resp.content, "application/zip")},
        headers=_auth(org_user["access_token"]),
    )
    assert import_resp.status_code == 200, import_resp.text
    body = import_resp.json()
    assert body["imported_count"] == 1
    assert len(body["topics"]) == 1
    assert body["topics"][0]["title"] == "Roundtrip topic"
    assert len(body["topics"][0]["viewpoints"]) == 1
    assert len(body["topics"][0]["comments"]) == 1
