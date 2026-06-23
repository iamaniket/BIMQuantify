"""Activity feed endpoint tests — since filter + pagination."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import pytest

from tests.conftest import (
    _auth,
    _create_attachment_row,
    _create_model,
    _create_project,
    _new_hash,
)

if TYPE_CHECKING:
    from httpx import AsyncClient

    from tests.conftest import FakeStorage


def _activity_url(project_id: str, **params: object) -> str:
    from urllib.parse import urlencode

    qs = urlencode({k: v for k, v in params.items() if v is not None})
    return f"/projects/{project_id}/activity" + (f"?{qs}" if qs else "")


def _timeline_url(project_id: str, **params: object) -> str:
    from urllib.parse import urlencode

    qs = urlencode({k: v for k, v in params.items() if v is not None})
    return f"/projects/{project_id}/activity/timeline" + (f"?{qs}" if qs else "")


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
    """Page size is clamped to 20-100 at the query layer."""
    project = await _create_project(client, org_user["access_token"])
    await _create_model(client, org_user["access_token"], project["id"])

    too_small = await client.get(
        _activity_url(project["id"], limit=19),
        headers=_auth(org_user["access_token"]),
    )
    assert too_small.status_code == 422

    # 20 is the floor — the portal's smallest page-size option. Guarding it keeps
    # the UI default (20) from silently 422-ing the activity feed.
    at_floor = await client.get(
        _activity_url(project["id"], limit=20),
        headers=_auth(org_user["access_token"]),
    )
    assert at_floor.status_code == 200

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


@pytest.mark.asyncio
async def test_activity_includes_finding_lifecycle(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """Creating and resolving a finding both surface in the project feed,
    scoped to the project. Create lands in the "create" bucket, the resolve
    edit in "change". Guards the two bugs that hid findings: the missing
    project_id and the action whitelist."""
    token = org_user["access_token"]
    project = await _create_project(client, token)

    created = await client.post(
        f"/projects/{project['id']}/findings",
        json={
            "title": "Brandwerende doorvoer ontbreekt",
            "description": "Doorvoer in brandscheiding niet afgewerkt.",
        },
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    finding_id = created.json()["id"]

    promote = await client.patch(
        f"/projects/{project['id']}/findings/{finding_id}",
        json={
            "status": "open",
            "deadline_date": "2026-08-01",
            "assignee_user_id": org_user["id"],
        },
        headers=_auth(token),
    )
    assert promote.status_code == 200, promote.text

    evidence = [await _create_attachment_row(project["id"])]
    resolved = await client.patch(
        f"/projects/{project['id']}/findings/{finding_id}",
        json={
            "status": "resolved",
            "resolution_note": "Afgekit en visueel gecontroleerd.",
            "resolution_evidence_ids": evidence,
        },
        headers=_auth(token),
    )
    assert resolved.status_code == 200, resolved.text

    resp = await client.get(_activity_url(project["id"]), headers=_auth(token))
    assert resp.status_code == 200
    by_action = {e["action"]: e for e in resp.json()}
    assert "finding.created" in by_action
    assert "finding.resolved" in by_action
    for action in ("finding.created", "finding.resolved"):
        entry = by_action[action]
        assert entry["resource_type"] == "finding"
        assert entry["resource_id"] == finding_id
    assert by_action["finding.created"]["category"] == "create"
    assert by_action["finding.resolved"]["category"] == "change"


@pytest.mark.asyncio
async def test_activity_create_category_filter(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """The `create` filter returns only `.created` events (model.created here),
    every row tagged "create"."""
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _create_model(client, token, project["id"])

    resp = await client.get(
        _activity_url(project["id"], category="create"),
        headers=_auth(token),
    )
    assert resp.status_code == 200
    entries = resp.json()
    assert entries, "expected at least the model.created row"
    assert all(e["category"] == "create" for e in entries)
    assert all(e["action"].endswith(".created") for e in entries)
    assert "model.created" in {e["action"] for e in entries}


@pytest.mark.asyncio
async def test_activity_delete_category(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """Deleting a finding surfaces a `finding.deleted` row in the "delete"
    bucket, and the `delete` filter returns only `.deleted` rows."""
    token = org_user["access_token"]
    project = await _create_project(client, token)

    created = await client.post(
        f"/projects/{project['id']}/findings",
        json={
            "title": "Tijdelijke bevinding",
            "description": "Wordt verwijderd.",
        },
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    finding_id = created.json()["id"]

    deleted = await client.delete(
        f"/projects/{project['id']}/findings/{finding_id}",
        headers=_auth(token),
    )
    assert deleted.status_code in (200, 204), deleted.text

    resp = await client.get(_activity_url(project["id"]), headers=_auth(token))
    assert resp.status_code == 200
    by_action = {e["action"]: e for e in resp.json()}
    assert "finding.deleted" in by_action
    assert by_action["finding.deleted"]["category"] == "delete"

    filtered = await client.get(
        _activity_url(project["id"], category="delete"),
        headers=_auth(token),
    )
    assert filtered.status_code == 200
    entries = filtered.json()
    assert entries, "expected at least the finding.deleted row"
    assert all(e["category"] == "delete" for e in entries)
    assert all(e["action"].endswith(".deleted") for e in entries)


@pytest.mark.asyncio
async def test_activity_includes_certificate_upload(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    org_user: dict[str, str],
) -> None:
    """A completed certificate upload appears (category upload); the noisy
    pending '.initiated' row is excluded from the feed."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)

    init = await client.post(
        f"/projects/{project['id']}/certificates/initiate",
        json={
            "filename": "ce-cert.pdf",
            "size_bytes": 4096,
            "content_type": "application/pdf",
            "content_sha256": _new_hash(),
            "certificate_type": "product",
        },
        headers=_auth(token),
    )
    assert init.status_code == 201, init.text
    cert = init.json()

    fake.objects[cert["storage_key"]] = b"x" * 4096
    complete = await client.post(
        f"/projects/{project['id']}/certificates/{cert['certificate_id']}/complete",
        headers=_auth(token),
    )
    assert complete.status_code == 200, complete.text

    resp = await client.get(_activity_url(project["id"]), headers=_auth(token))
    assert resp.status_code == 200
    entries = resp.json()
    actions = {e["action"] for e in entries}
    assert "certificate.completed" in actions
    assert "certificate.initiated" not in actions
    completed = next(e for e in entries if e["action"] == "certificate.completed")
    assert completed["category"] == "upload"
    assert completed["resource_type"] == "certificates"


# --------------------------------------------------------------------------- #
# Timeline endpoint
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_timeline_buckets_sum_to_list_total(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """Each bucket carries a start + count, and the counts sum to the list's
    X-Total-Count (the timeline counts the same rows, just grouped by time)."""
    token = org_user["access_token"]
    project = await _create_project(client, token)
    for i in range(3):
        await _create_model(client, token, project["id"], name=f"M{i}")

    resp = await client.get(_timeline_url(project["id"]), headers=_auth(token))
    assert resp.status_code == 200, resp.text
    buckets = resp.json()
    assert buckets, "expected at least one bucket"
    assert all("bucket_start" in b and "count" in b for b in buckets)

    listing = await client.get(_activity_url(project["id"]), headers=_auth(token))
    total = int(listing.headers["X-Total-Count"])
    assert sum(b["count"] for b in buckets) == total


@pytest.mark.asyncio
async def test_timeline_buckets_carry_category_and_resource_breakdowns(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """Each bucket breaks its count down by feed category and resource type, and
    both breakdowns sum back to the bucket count. A created finding lands in the
    "create"/"finding" cells; a model in "create"/"model". All events happen
    'now', so they collapse into one week bucket."""
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _create_model(client, token, project["id"], name="Arch")

    created = await client.post(
        f"/projects/{project['id']}/findings",
        json={"title": "Breakdown finding", "description": "x"},
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text

    resp = await client.get(_timeline_url(project["id"]), headers=_auth(token))
    assert resp.status_code == 200, resp.text
    buckets = resp.json()
    assert buckets, "expected at least one bucket"

    for b in buckets:
        assert "by_category" in b and "by_resource" in b
        # Only non-zero cells, and each breakdown reconstitutes the total.
        assert all(v > 0 for v in b["by_category"].values())
        assert all(v > 0 for v in b["by_resource"].values())
        assert sum(b["by_category"].values()) == b["count"]
        assert sum(b["by_resource"].values()) == b["count"]

    # Fold every bucket together (all events are 'now' but don't assume one
    # bucket) and assert the create/finding + create/model cells are present.
    cats: dict[str, int] = {}
    resources: dict[str, int] = {}
    for b in buckets:
        for k, v in b["by_category"].items():
            cats[k] = cats.get(k, 0) + v
        for k, v in b["by_resource"].items():
            resources[k] = resources.get(k, 0) + v
    assert cats.get("create", 0) >= 2  # model.created + finding.created
    assert resources.get("finding", 0) >= 1
    assert resources.get("model", 0) >= 1


@pytest.mark.asyncio
async def test_timeline_day_and_week_agree_on_total(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """`day` and `week` change the grouping, not the total event count. Because
    every event in the test happens 'now', both collapse to a single bucket."""
    token = org_user["access_token"]
    project = await _create_project(client, token)
    for i in range(3):
        await _create_model(client, token, project["id"], name=f"M{i}")

    day = await client.get(_timeline_url(project["id"], bucket="day"), headers=_auth(token))
    week = await client.get(_timeline_url(project["id"], bucket="week"), headers=_auth(token))
    assert day.status_code == 200
    assert week.status_code == 200
    day_total = sum(b["count"] for b in day.json())
    week_total = sum(b["count"] for b in week.json())
    assert day_total == week_total
    assert day_total >= 3


@pytest.mark.asyncio
async def test_timeline_category_filter_matches_list(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """The timeline's `category` filter buckets the same rows the list filter
    returns (shared `_apply_category_filter`)."""
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _create_model(client, token, project["id"])

    timeline = await client.get(
        _timeline_url(project["id"], category="create"), headers=_auth(token)
    )
    assert timeline.status_code == 200
    timeline_total = sum(b["count"] for b in timeline.json())

    listing = await client.get(
        _activity_url(project["id"], category="create"), headers=_auth(token)
    )
    list_total = int(listing.headers["X-Total-Count"])
    assert timeline_total == list_total
    assert timeline_total >= 1  # at least model.created


@pytest.mark.asyncio
async def test_timeline_excludes_initiated(
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    org_user: dict[str, str],
) -> None:
    """The noisy '.initiated' rows are excluded from the timeline just like the
    list — the shared `_EXCLUDED_ACTIONS` denylist applies, so the timeline
    total equals the list total."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)

    init = await client.post(
        f"/projects/{project['id']}/certificates/initiate",
        json={
            "filename": "ce-cert.pdf",
            "size_bytes": 4096,
            "content_type": "application/pdf",
            "content_sha256": _new_hash(),
            "certificate_type": "product",
        },
        headers=_auth(token),
    )
    assert init.status_code == 201, init.text
    cert = init.json()
    fake.objects[cert["storage_key"]] = b"x" * 4096
    complete = await client.post(
        f"/projects/{project['id']}/certificates/{cert['certificate_id']}/complete",
        headers=_auth(token),
    )
    assert complete.status_code == 200, complete.text

    timeline = await client.get(_timeline_url(project["id"]), headers=_auth(token))
    assert timeline.status_code == 200
    timeline_total = sum(b["count"] for b in timeline.json())

    listing = await client.get(_activity_url(project["id"]), headers=_auth(token))
    assert timeline_total == int(listing.headers["X-Total-Count"])


@pytest.mark.asyncio
async def test_timeline_returns_only_nonempty_buckets(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """Server returns ONLY buckets that have events (client zero-fills the rest):
    a fresh project's events all land 'now', so day-grain yields exactly one
    bucket — never a run of zero rows for the preceding days."""
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _create_model(client, token, project["id"])

    resp = await client.get(_timeline_url(project["id"], bucket="day"), headers=_auth(token))
    assert resp.status_code == 200
    buckets = resp.json()
    assert len(buckets) == 1
    assert buckets[0]["count"] >= 1


@pytest.mark.asyncio
async def test_timeline_since_future_is_empty(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """A `since` far in the future returns no buckets."""
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _create_model(client, token, project["id"])

    future = (datetime.now(tz=timezone.utc) + timedelta(hours=1)).isoformat()
    resp = await client.get(
        _timeline_url(project["id"], since=future), headers=_auth(token)
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_timeline_requires_membership(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    """A verified user from a different org can't read the timeline — the
    project doesn't exist in their tenant schema, so it's a 404."""
    project = await _create_project(client, org_user["access_token"])
    await _create_model(client, org_user["access_token"], project["id"])

    resp = await client.get(
        _timeline_url(project["id"]),
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404
