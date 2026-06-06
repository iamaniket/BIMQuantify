"""Activity feed endpoint tests — since filter + pagination."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import pytest

from tests.conftest import _auth, _create_model, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient


def _activity_url(project_id: str, **params: object) -> str:
    from urllib.parse import urlencode

    qs = urlencode({k: v for k, v in params.items() if v is not None})
    return f"/projects/{project_id}/activity" + (f"?{qs}" if qs else "")


@pytest.mark.asyncio
async def test_activity_returns_entries(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _create_model(client, org_user["access_token"], project["id"])

    resp = await client.get(
        _activity_url(project["id"]),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) >= 1


@pytest.mark.asyncio
async def test_activity_since_filters_old_entries(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """A `since` far in the future should return no entries."""
    project = await _create_project(client, org_user["access_token"])
    await _create_model(client, org_user["access_token"], project["id"])

    future = (datetime.now(tz=timezone.utc) + timedelta(hours=1)).isoformat()
    resp = await client.get(
        _activity_url(project["id"], since=future),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_activity_since_includes_recent(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """A `since` in the recent past should include entries just created."""
    project = await _create_project(client, org_user["access_token"])
    await _create_model(client, org_user["access_token"], project["id"])

    past = (datetime.now(tz=timezone.utc) - timedelta(minutes=5)).isoformat()
    resp = await client.get(
        _activity_url(project["id"], since=past),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


@pytest.mark.asyncio
async def test_activity_category_filter(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    await _create_model(client, org_user["access_token"], project["id"])

    resp = await client.get(
        _activity_url(project["id"], category="change"),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    entries = resp.json()
    assert all(e["category"] == "change" for e in entries)


@pytest.mark.asyncio
async def test_activity_pagination(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user["access_token"])
    # Create multiple models to generate multiple entries.
    for i in range(3):
        await _create_model(
            client, org_user["access_token"], project["id"], name=f"M{i}"
        )

    resp = await client.get(
        _activity_url(project["id"], limit=2),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    resp2 = await client.get(
        _activity_url(project["id"], limit=2, offset=2),
        headers=_auth(org_user["access_token"]),
    )
    assert resp2.status_code == 200
    assert len(resp2.json()) >= 1
