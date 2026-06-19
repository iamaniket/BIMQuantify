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
        _activity_url(project["id"], limit=25),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) <= 25
    # X-Total-Count reflects the full match set; the page fits within it.
    total = int(resp.headers["X-Total-Count"])
    assert total >= 3
    assert len(rows) == total


@pytest.mark.asyncio
async def test_activity_limit_bounds(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """Page size is clamped to 25-100 at the query layer."""
    project = await _create_project(client, org_user["access_token"])
    await _create_model(client, org_user["access_token"], project["id"])

    too_small = await client.get(
        _activity_url(project["id"], limit=24),
        headers=_auth(org_user["access_token"]),
    )
    assert too_small.status_code == 422

    too_large = await client.get(
        _activity_url(project["id"], limit=101),
        headers=_auth(org_user["access_token"]),
    )
    assert too_large.status_code == 422


@pytest.mark.asyncio
async def test_activity_sort_by_created_at(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """order_dir flips the created_at ordering; default is newest-first."""
    project = await _create_project(client, org_user["access_token"])
    for i in range(3):
        await _create_model(
            client, org_user["access_token"], project["id"], name=f"M{i}"
        )

    asc = await client.get(
        _activity_url(project["id"], order_by="created_at", order_dir="asc"),
        headers=_auth(org_user["access_token"]),
    )
    assert asc.status_code == 200
    asc_dates = [e["created_at"] for e in asc.json()]
    assert asc_dates == sorted(asc_dates)

    desc = await client.get(
        _activity_url(project["id"], order_by="created_at", order_dir="desc"),
        headers=_auth(org_user["access_token"]),
    )
    assert desc.status_code == 200
    desc_dates = [e["created_at"] for e in desc.json()]
    assert desc_dates == sorted(desc_dates, reverse=True)

    # Default order (no sort params) is newest-first.
    default = await client.get(
        _activity_url(project["id"]),
        headers=_auth(org_user["access_token"]),
    )
    default_dates = [e["created_at"] for e in default.json()]
    assert default_dates == sorted(default_dates, reverse=True)


@pytest.mark.asyncio
async def test_activity_sort_by_action(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """`action` is a whitelisted sort key (the 'type' dimension)."""
    project = await _create_project(client, org_user["access_token"])
    await _create_model(client, org_user["access_token"], project["id"])

    resp = await client.get(
        _activity_url(project["id"], order_by="action", order_dir="asc"),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_activity_sort_invalid_key(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """An order_by outside the whitelist 422s rather than silently falling back."""
    project = await _create_project(client, org_user["access_token"])
    await _create_model(client, org_user["access_token"], project["id"])

    resp = await client.get(
        _activity_url(project["id"], order_by="resource_type"),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
