"""BCF viewpoint snapshot upload — tenant-scoping regression tests (B2).

`complete_snapshot_upload` must never trust a client-supplied storage key: the
key is recomputed server-side from the org schema + topic/viewpoint GUIDs, so a
caller in org A cannot point a viewpoint at org B's object in the shared
attachments bucket. The read path (`_resolve_snapshot_url`) refuses to presign a
key outside the active org's `bcf-snapshots/<schema>/` prefix as defense-in-depth
for any pre-existing bad rows.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

import pytest

from bimdossier_api.models.bcf_viewpoint import BcfViewpoint
from bimdossier_api.routers.bcf._shared import _resolve_snapshot_url
from tests.conftest import FakeStorage, _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient


_PNG = b"\x89PNG\r\n\x1a\n" + b"snapshot-bytes"


def _viewpoint() -> dict[str, object]:
    return {
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


async def _topic_with_viewpoint(client: AsyncClient, token: str, project_id: str) -> dict[str, str]:
    """Create a topic carrying one viewpoint; return ids + guids."""
    resp = await client.post(
        f"/projects/{project_id}/bcf-topics",
        json={"title": "snap", "viewpoint": _viewpoint()},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    vp = body["viewpoints"][0]
    return {
        "topic_id": body["id"],
        "topic_guid": body["guid"],
        "vp_id": vp["id"],
        "vp_guid": vp["guid"],
    }


async def _initiate(
    client: AsyncClient, token: str, project_id: str, topic_id: str, vp_id: str
) -> dict[str, str]:
    resp = await client.post(
        f"/projects/{project_id}/bcf-topics/{topic_id}/viewpoints/{vp_id}/snapshot-upload",
        json={"content_type": "image/png", "content_length": len(_PNG)},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_complete_ignores_client_supplied_key(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    """A malicious storage_key pointing at another org's prefix is discarded;
    the server recomputes and persists this org's canonical key."""
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="snap-a")
    ids = await _topic_with_viewpoint(client, org_user["access_token"], project["id"])

    init = await _initiate(
        client, org_user["access_token"], project["id"], ids["topic_id"], ids["vp_id"]
    )
    canonical_key = init["storage_key"]
    fake.objects[canonical_key] = _PNG  # the real (presigned) upload

    org_a_hex = org_user["organization_id"].replace("-", "")
    org_b_hex = other_org_user["organization_id"].replace("-", "")
    assert f"org_{org_a_hex}" in canonical_key
    malicious_key = f"bcf-snapshots/org_{org_b_hex}/{ids['topic_guid']}/{ids['vp_guid']}.png"

    complete = await client.post(
        f"/projects/{project['id']}/bcf-topics/{ids['topic_id']}"
        f"/viewpoints/{ids['vp_id']}/snapshot-complete",
        json={"storage_key": malicious_key},
        headers=_auth(org_user["access_token"]),
    )
    assert complete.status_code == 200, complete.text

    # The persisted key must be this org's canonical key — verify via the read
    # path, which presigns whatever was stored.
    topic = (
        await client.get(
            f"/projects/{project['id']}/bcf-topics/{ids['topic_id']}",
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    snapshot_url = topic["viewpoints"][0]["snapshot_url"]
    assert snapshot_url is not None
    assert f"org_{org_a_hex}" in snapshot_url
    assert f"org_{org_b_hex}" not in snapshot_url


async def test_complete_rejects_when_not_uploaded(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    org_user: dict[str, str],
) -> None:
    """No object at the canonical key → 422 OBJECT_NOT_UPLOADED (no row mutated)."""
    client, _fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="snap-miss")
    ids = await _topic_with_viewpoint(client, org_user["access_token"], project["id"])

    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics/{ids['topic_id']}"
        f"/viewpoints/{ids['vp_id']}/snapshot-complete",
        json={},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "OBJECT_NOT_UPLOADED"


async def test_complete_happy_path(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    org_user: dict[str, str],
) -> None:
    """Initiate → upload → complete → the viewpoint resolves a snapshot URL."""
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="snap-ok")
    ids = await _topic_with_viewpoint(client, org_user["access_token"], project["id"])

    init = await _initiate(
        client, org_user["access_token"], project["id"], ids["topic_id"], ids["vp_id"]
    )
    fake.objects[init["storage_key"]] = _PNG

    complete = await client.post(
        f"/projects/{project['id']}/bcf-topics/{ids['topic_id']}"
        f"/viewpoints/{ids['vp_id']}/snapshot-complete",
        json={"storage_key": init["storage_key"]},
        headers=_auth(org_user["access_token"]),
    )
    assert complete.status_code == 200, complete.text

    topic = (
        await client.get(
            f"/projects/{project['id']}/bcf-topics/{ids['topic_id']}",
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    assert topic["viewpoints"][0]["snapshot_url"] is not None
    assert init["storage_key"] in topic["viewpoints"][0]["snapshot_url"]


@pytest.mark.parametrize(
    ("stored_key", "expected_prefix", "resolves"),
    [
        ("bcf-snapshots/org_aaaa/t/v.png", "bcf-snapshots/org_aaaa/", True),
        ("bcf-snapshots/org_bbbb/t/v.png", "bcf-snapshots/org_aaaa/", False),
        ("attachments/evil.png", "bcf-snapshots/org_aaaa/", False),
        (None, "bcf-snapshots/org_aaaa/", False),
    ],
)
async def test_resolve_snapshot_url_refuses_foreign_prefix(
    stored_key: str | None, expected_prefix: str, resolves: bool
) -> None:
    """Read-path guard: a key outside the active org's prefix never presigns."""
    vp = BcfViewpoint(guid="vp-guid", snapshot_storage_key=stored_key)
    url = await _resolve_snapshot_url(vp, FakeStorage(), expected_prefix)
    assert (url is not None) is resolves
