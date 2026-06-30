"""Tests for the free-tier activity timeline (derived, card-only).

The free wedge keeps no `audit_log`, so the trend is SYNTHESIZED from existing
free-table timestamps (`routers/free_activity.compute_free_activity_timeline`).
These tests assert the derived buckets reflect real events, that the participant
gate + kill-switch hold, and that an empty project yields no buckets.
"""

import os

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from tests.conftest import FakeStorage
from tests.test_free_viewer import (
    _auth,
    _callback_succeeded,
    _create_document,
    _create_project,
    _free_token,
    _upload,
)


def _aggregate(buckets: list[dict]) -> tuple[dict[str, int], dict[str, int], int]:
    """Sum a timeline's per-bucket breakdowns into totals (events all land in the
    same week under test, but summing keeps the assertion order-independent)."""
    by_category: dict[str, int] = {}
    by_resource: dict[str, int] = {}
    total = 0
    for b in buckets:
        total += b["count"]
        for k, n in b["by_category"].items():
            by_category[k] = by_category.get(k, 0) + n
        for k, n in b["by_resource"].items():
            by_resource[k] = by_resource.get(k, 0) + n
    return by_category, by_resource, total


async def test_free_activity_timeline_reflects_events(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A project's containers, files (upload + terminal extraction), findings
    (create + edit) all surface as the derived create/upload/scan/change events."""
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "fa-events@example.com")
    pid = await _create_project(client, token, name="Activity")
    did = await _create_document(client, token, pid, name="Arch")

    # Upload a file and drive its extraction to terminal succeeded → upload + scan.
    up = await _upload(client, fake, token, pid, did, filename="a.ifc")
    await _callback_succeeded(client, up["id"], up["storage_key"])

    # Two findings (create), then edit one (change via updated_at > created_at).
    sid = (
        await client.post(
            f"/free/documents/{did}/findings",
            json={"title": "crack", "severity": "high"},
            headers=_auth(token),
        )
    ).json()["id"]
    await client.post(
        f"/free/documents/{did}/findings",
        json={"title": "leak", "severity": "low"},
        headers=_auth(token),
    )
    patched = await client.patch(
        f"/free/findings/{sid}", json={"status": "resolved"}, headers=_auth(token)
    )
    assert patched.status_code == 200, patched.text

    resp = await client.get(
        f"/free/projects/{pid}/activity/timeline?bucket=week", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    by_category, by_resource, total = _aggregate(resp.json())

    # create: 1 document + 2 findings; upload: 1 file; scan: 1 extraction; change: 1 edit.
    assert by_category == {"create": 3, "upload": 1, "scan": 1, "change": 1}
    # document(create); project_file(upload + scan); finding(2 create + 1 change).
    assert by_resource == {"document": 1, "project_file": 2, "finding": 3}
    assert total == 6


async def test_free_activity_timeline_empty_project(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A brand-new project (no containers/findings/members) has no derived events."""
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "fa-empty@example.com")
    pid = await _create_project(client, token, name="Empty")

    resp = await client.get(
        f"/free/projects/{pid}/activity/timeline?bucket=week", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


async def test_free_activity_timeline_non_participant_404(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A different free user cannot read someone else's project timeline (404,
    RLS-scoped — the same gate as the rest of the free read surface)."""
    client, _ = free_tier_storage_client
    token_a = await _free_token(client, session_maker, "fa-iso-a@example.com")
    token_b = await _free_token(client, session_maker, "fa-iso-b@example.com")
    pid = await _create_project(client, token_a, name="A only")

    resp = await client.get(f"/free/projects/{pid}/activity/timeline", headers=_auth(token_b))
    assert resp.status_code == 404
    assert resp.json()["detail"] == "FREE_PROJECT_NOT_FOUND"


async def test_free_activity_timeline_403_when_disabled(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The endpoint is flag-gated like the rest of /free/* (FREE_TIER_DISABLED)."""
    prev = os.environ.get("FREE_TIER_ENABLED")
    os.environ["FREE_TIER_ENABLED"] = "false"
    get_settings.cache_clear()
    try:
        token = await _free_token(client, session_maker, "fa-disabled@example.com")
        resp = await client.get(
            "/free/projects/00000000-0000-0000-0000-000000000000/activity/timeline",
            headers=_auth(token),
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "FREE_TIER_DISABLED"
    finally:
        if prev is None:
            os.environ.pop("FREE_TIER_ENABLED", None)
        else:
            os.environ["FREE_TIER_ENABLED"] = prev
        get_settings.cache_clear()
