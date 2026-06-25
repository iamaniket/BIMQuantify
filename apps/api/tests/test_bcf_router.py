"""HTTP-level integration tests for BCF topic CRUD + import/export.

Tests follow the same pattern as test_risks.py: tenant-isolated, role-gated,
using the conftest helpers (_create_project, _auth, _add_member).
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from tests.conftest import (
    _add_member,
    _auth,
    _create_attachment_row,
    _create_document,
    _create_project,
)

if TYPE_CHECKING:
    from httpx import AsyncClient


_RECT_ANNOTATION: dict[str, object] = {
    "id": "a1",
    "tool": "rect",
    "points": [[0.1, 0.1], [0.5, 0.5]],
    "color": "#ef4444",
    "strokeWidth": 2,
}


def _viewpoint_2d(
    *,
    file_id: str | None = None,
    page: int = 1,
    annotations: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    vs: dict[str, object] = {
        "center_x": 0.5,
        "center_y": 0.5,
        "zoom": 1.0,
        "file_type": "pdf",
        "page": page,
        "annotations": annotations if annotations is not None else [_RECT_ANNOTATION],
    }
    overrides: dict[str, object] = {"is_2d": True, "view_state_2d": vs}
    if file_id is not None:
        overrides["linked_file_id"] = file_id
    return _viewpoint(**overrides)


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


# ---------------------------------------------------------------------------
# 2D markup (PDF annotations stored in view_state_2d)
# ---------------------------------------------------------------------------


async def test_create_topic_2d_viewpoint_round_trips_annotations(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(viewpoint=_viewpoint_2d(page=3)),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    vp = resp.json()["viewpoints"][0]
    assert vp["is_2d"] is True
    vs = vp["view_state_2d"]
    assert vs["page"] == 3
    assert vs["file_type"] == "pdf"
    assert len(vs["annotations"]) == 1
    ann = vs["annotations"][0]
    assert ann["tool"] == "rect"
    assert ann["points"] == [[0.1, 0.1], [0.5, 0.5]]
    assert ann["strokeWidth"] == 2


async def test_markup_2d_endpoint_returns_linked_topics(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    file_id = await _create_attachment_row(project["id"])

    created = (
        await client.post(
            f"/projects/{project['id']}/bcf-topics",
            json=_topic(title="Crack on plan", viewpoint=_viewpoint_2d(file_id=file_id, page=2)),
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics/markup-2d?file_id={file_id}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 1
    item = items[0]
    assert item["topic_id"] == created["id"]
    assert item["title"] == "Crack on plan"
    assert item["page"] == 2
    assert item["annotations"][0]["tool"] == "rect"


async def test_markup_2d_endpoint_filters_by_file(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    file_a = await _create_attachment_row(project["id"])
    file_b = await _create_attachment_row(project["id"])

    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="On file A", viewpoint=_viewpoint_2d(file_id=file_a)),
        headers=_auth(org_user["access_token"]),
    )

    # Querying file B returns nothing; querying file A returns the topic.
    resp_b = await client.get(
        f"/projects/{project['id']}/bcf-topics/markup-2d?file_id={file_b}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp_b.status_code == 200
    assert resp_b.json() == []

    resp_a = await client.get(
        f"/projects/{project['id']}/bcf-topics/markup-2d?file_id={file_a}",
        headers=_auth(org_user["access_token"]),
    )
    assert len(resp_a.json()) == 1


async def test_markup_2d_excludes_3d_viewpoints(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    file_id = await _create_attachment_row(project["id"])
    # A normal 3D viewpoint linked to the same file must not show up as markup.
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(viewpoint=_viewpoint(linked_file_id=file_id)),
        headers=_auth(org_user["access_token"]),
    )
    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics/markup-2d?file_id={file_id}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# Document + version + dimension association
# ---------------------------------------------------------------------------


async def _create_document_file(
    project_id: str,
    document_id: str,
    *,
    version: int = 1,
    ifc_project_guid: str | None = None,
    filename: str = "model.ifc",
) -> str:
    """Insert a ready model_source ProjectFile (a model version) and return id."""
    from uuid import uuid4

    from sqlalchemy import text

    from bimdossier_api.db import get_session_maker

    fid = str(uuid4())
    async with get_session_maker()() as s, s.begin():
        candidates = (
            await s.execute(
                text(
                    "SELECT schema_name FROM information_schema.schemata "
                    "WHERE schema_name = 'public' OR schema_name LIKE 'org\\_%' ESCAPE '\\'"
                )
            )
        ).scalars().all()
        target = "public"
        for cand in candidates:
            hit = (
                await s.execute(
                    text(f'SELECT 1 FROM "{cand}".projects WHERE id = :pid'),
                    {"pid": project_id},
                )
            ).scalar()
            if hit:
                target = cand
                break
        await s.execute(
            text(
                f'INSERT INTO "{target}".project_files '
                "(id, project_id, role, status, file_type, document_id, ifc_project_guid, "
                " storage_key, original_filename, size_bytes, content_type, version_number) "
                "VALUES (:id, :pid, 'model_source', 'ready', 'ifc', :mid, :guid, :sk, "
                ":fn, 100, 'application/octet-stream', :ver)"
            ),
            {
                "id": fid,
                "pid": project_id,
                "mid": document_id,
                "guid": ifc_project_guid,
                "sk": f"models/{fid}.ifc",
                "fn": filename,
                "ver": version,
            },
        )
    return fid


async def test_create_topic_with_model_and_file(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user["access_token"])
    model = await _create_document(client, org_user["access_token"], project["id"])
    file_id = await _create_document_file(project["id"], model["id"], version=2)

    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(linked_document_id=model["id"], linked_file_id=file_id),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["linked_document_id"] == model["id"]
    assert body["linked_file_id"] == file_id
    assert body["is_2d"] is False
    assert body["model_version"] == 2
    assert body["file_type"] == "ifc"


async def test_create_topic_backfills_model_from_file(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Passing only linked_file_id backfills linked_document_id from the file."""
    project = await _create_project(client, org_user["access_token"])
    model = await _create_document(client, org_user["access_token"], project["id"])
    file_id = await _create_document_file(project["id"], model["id"])

    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(linked_file_id=file_id),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["linked_document_id"] == model["id"]


async def test_create_topic_derives_dimension_and_file_from_2d_viewpoint(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """A 2D viewpoint stamps the topic as 2D and inherits its linked_file_id."""
    project = await _create_project(client, org_user["access_token"])
    file_id = await _create_attachment_row(project["id"])

    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(viewpoint=_viewpoint_2d(file_id=file_id, page=4)),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["is_2d"] is True
    assert body["linked_file_id"] == file_id


async def test_create_topic_linked_file_404_other_project(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project_a = await _create_project(client, org_user["access_token"], name="A")
    project_b = await _create_project(client, org_user["access_token"], name="B")
    model_b = await _create_document(client, org_user["access_token"], project_b["id"])
    file_b = await _create_document_file(project_b["id"], model_b["id"])

    resp = await client.post(
        f"/projects/{project_a['id']}/bcf-topics",
        json=_topic(linked_file_id=file_b),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "PROJECT_FILE_NOT_FOUND"


async def test_list_filter_by_document_id(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    model_a = await _create_document(client, org_user["access_token"], project["id"], name="A")
    model_b = await _create_document(client, org_user["access_token"], project["id"], name="B")

    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="On A", linked_document_id=model_a["id"]),
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="On B", linked_document_id=model_b["id"]),
        headers=_auth(org_user["access_token"]),
    )

    resp = await client.get(
        f"/projects/{project['id']}/bcf-topics?document_id={model_a['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["title"] == "On A"
    assert items[0]["linked_document_id"] == model_a["id"]


async def test_list_filter_by_file_id(client: AsyncClient, org_user: dict[str, str]) -> None:
    """file_id is the 'this version only' filter — issues across versions of one model."""
    project = await _create_project(client, org_user["access_token"])
    model = await _create_document(client, org_user["access_token"], project["id"])
    v1 = await _create_document_file(project["id"], model["id"], version=1, filename="v1.ifc")
    v2 = await _create_document_file(project["id"], model["id"], version=2, filename="v2.ifc")

    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="On v1", linked_file_id=v1),
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="On v2", linked_file_id=v2),
        headers=_auth(org_user["access_token"]),
    )

    # Document-scoped: both versions show (default viewer behaviour).
    by_model = await client.get(
        f"/projects/{project['id']}/bcf-topics?document_id={model['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert len(by_model.json()) == 2

    # Version-scoped: only the v2 topic.
    by_file = await client.get(
        f"/projects/{project['id']}/bcf-topics?file_id={v2}",
        headers=_auth(org_user["access_token"]),
    )
    items = by_file.json()
    assert len(items) == 1
    assert items[0]["title"] == "On v2"
    assert items[0]["model_version"] == 2


async def test_list_filter_by_is_2d(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user["access_token"])
    file_id = await _create_attachment_row(project["id"])
    # One 3D topic, one 2D topic.
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="3D issue", viewpoint=_viewpoint()),
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/bcf-topics",
        json=_topic(title="2D issue", viewpoint=_viewpoint_2d(file_id=file_id)),
        headers=_auth(org_user["access_token"]),
    )

    only_2d = await client.get(
        f"/projects/{project['id']}/bcf-topics?is_2d=true",
        headers=_auth(org_user["access_token"]),
    )
    items_2d = only_2d.json()
    assert len(items_2d) == 1
    assert items_2d[0]["title"] == "2D issue"
    assert items_2d[0]["is_2d"] is True

    only_3d = await client.get(
        f"/projects/{project['id']}/bcf-topics?is_2d=false",
        headers=_auth(org_user["access_token"]),
    )
    items_3d = only_3d.json()
    assert len(items_3d) == 1
    assert items_3d[0]["title"] == "3D issue"


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


async def test_import_matches_header_file_to_model(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """A BCF Header/File with an IfcProject GUID auto-links to the matching model."""
    from bimdossier_api.bcf.generator import generate_bcf_archive
    from bimdossier_api.bcf.types import ParsedBcf, ParsedFile, ParsedTopic

    guid = "2O2Fr$t4X7Zf8NOew3FNr2"
    project = await _create_project(client, org_user["access_token"], name="Importer")
    model = await _create_document(client, org_user["access_token"], project["id"])
    file_id = await _create_document_file(
        project["id"], model["id"], version=1, ifc_project_guid=guid, filename="tower.ifc"
    )

    archive = generate_bcf_archive(
        ParsedBcf(
            version="3.0",
            topics=[
                ParsedTopic(
                    guid=str(uuid4()),
                    title="Clash near core",
                    files=[ParsedFile(ifc_project=guid, filename="tower.ifc")],
                )
            ],
        )
    )

    import_resp = await client.post(
        f"/projects/{project['id']}/bcf-topics/import",
        files={"file": ("in.bcf", archive, "application/zip")},
        headers=_auth(org_user["access_token"]),
    )
    assert import_resp.status_code == 200, import_resp.text
    topic = import_resp.json()["topics"][0]
    assert topic["linked_document_id"] == model["id"]
    assert topic["linked_file_id"] == file_id
