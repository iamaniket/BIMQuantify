"""Idempotency-Key support on the offline-replayed create endpoints.

Offline mobile clients (apps/mobile) replay `POST /findings` and
`POST /attachments/initiate` from their outbox when a response is lost. Without
dedup a single snag would be created twice. A client sends a stable
`Idempotency-Key` header (a UUID minted once per queued create, never
regenerated on retry); the server records it on the created row behind a
per-user partial-unique index, so a replay returns the original row instead of
inserting a second.

These are the spec for that contract:
  - same key + same user  -> one row, identical response
  - different keys        -> distinct rows
  - no header             -> unchanged (no dedup)
  - key is scoped per user and per tenant (schema)
  - a failed (4xx) request is not "claimed" — a fixed retry under the same key
    still succeeds
  - a malformed key is a 400, not silently dropped
  - concurrent duplicates never create two rows (the DB partial-unique index is
    the real guarantee; the route maps the violation to a retryable 409)
  - attachment initiate replay returns the same row with a FRESH presigned URL
    (the original may have expired)
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from tests.conftest import _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient

    from tests.conftest import FakeStorage

# A fixed valid 64-char hex sha so two keyed initiate calls represent the same
# photo bytes (idempotency matches on the key, not the content, but a realistic
# replay carries identical content).
_FIXED_SHA = "a" * 64


def _finding_payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "title": "Brandwerende doorvoer ontbreekt",
        "description": "Doorvoer in brandscheiding nabij meterkast niet afgewerkt.",
    }
    base.update(overrides)
    return base


def _idem(token: str, key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Idempotency-Key": key}


async def _total_findings(client: AsyncClient, token: str, project_id: str) -> int:
    resp = await client.get(
        f"/projects/{project_id}/findings", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    return int(resp.headers["X-Total-Count"])


# ---------------------------------------------------------------------------
# Findings — POST /projects/{pid}/findings
# ---------------------------------------------------------------------------


async def test_same_key_twice_creates_one_finding_and_identical_response(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    key = "11111111-1111-4111-8111-111111111111"

    first = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(),
        headers=_idem(token, key),
    )
    assert first.status_code == 201, first.text

    second = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(),
        headers=_idem(token, key),
    )
    assert second.status_code == 201, second.text

    # Same row replayed: identical id + created_at, and only ONE row exists.
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["created_at"] == first.json()["created_at"]
    assert await _total_findings(client, token, project["id"]) == 1


async def test_different_keys_create_two_findings(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)

    a = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(),
        headers=_idem(token, "key-aaaa-1111"),
    )
    b = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(),
        headers=_idem(token, "key-bbbb-2222"),
    )
    assert a.status_code == 201 and b.status_code == 201
    assert a.json()["id"] != b.json()["id"]
    assert await _total_findings(client, token, project["id"]) == 2


async def test_missing_header_creates_two_findings(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """No Idempotency-Key → today's behaviour: every POST is a fresh row."""
    token = org_user["access_token"]
    project = await _create_project(client, token)

    a = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(),
        headers=_auth(token),
    )
    b = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(),
        headers=_auth(token),
    )
    assert a.status_code == 201 and b.status_code == 201
    assert a.json()["id"] != b.json()["id"]
    assert await _total_findings(client, token, project["id"]) == 2


async def test_idempotency_key_scoped_per_user(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    """Two users in the SAME org reusing the same literal key each get their own
    finding — a leaked/guessed key can't replay another member's write."""
    owner_token = org_user["access_token"]
    project = await _create_project(client, owner_token)
    # Make the second user a member so they can create in this project.
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(owner_token),
    )

    key = "shared-key-9999"
    a = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(),
        headers=_idem(owner_token, key),
    )
    b = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(),
        headers=_idem(same_org_user["access_token"], key),
    )
    assert a.status_code == 201, a.text
    assert b.status_code == 201, b.text
    assert a.json()["id"] != b.json()["id"]
    assert await _total_findings(client, owner_token, project["id"]) == 2


async def test_idempotency_cross_tenant_isolation(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    """The same literal key used by users in two different orgs never collides —
    each tenant schema has its own findings table."""
    a_token = org_user["access_token"]
    b_token = other_org_user["access_token"]
    project_a = await _create_project(client, a_token, name="A")
    project_b = await _create_project(client, b_token, name="B")

    key = "cross-tenant-key-0001"
    ra = await client.post(
        f"/projects/{project_a['id']}/findings",
        json=_finding_payload(),
        headers=_idem(a_token, key),
    )
    rb = await client.post(
        f"/projects/{project_b['id']}/findings",
        json=_finding_payload(),
        headers=_idem(b_token, key),
    )
    assert ra.status_code == 201, ra.text
    assert rb.status_code == 201, rb.text
    assert ra.json()["id"] != rb.json()["id"]
    assert await _total_findings(client, a_token, project_a["id"]) == 1
    assert await _total_findings(client, b_token, project_b["id"]) == 1


async def test_failed_create_not_claimed_under_key(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """A 4xx is not cached: a fixed payload retried under the same key succeeds."""
    token = org_user["access_token"]
    project = await _create_project(client, token)
    key = "retry-after-fix-key"

    bad = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(title=""),  # min_length=1 → 422
        headers=_idem(token, key),
    )
    assert bad.status_code == 422, bad.text

    good = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(),
        headers=_idem(token, key),
    )
    assert good.status_code == 201, good.text
    assert await _total_findings(client, token, project["id"]) == 1


async def test_malformed_idempotency_key_rejected(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)

    # Contains ':' — reserved, would break the (would-be) scoping convention.
    colon = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(),
        headers=_idem(token, "has:colon"),
    )
    assert colon.status_code == 400, colon.text
    assert colon.json()["detail"] == "IDEMPOTENCY_KEY_INVALID"

    # Over 200 chars.
    toolong = await client.post(
        f"/projects/{project['id']}/findings",
        json=_finding_payload(),
        headers=_idem(token, "x" * 201),
    )
    assert toolong.status_code == 400, toolong.text


async def test_concurrent_duplicate_creates_one_row(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    """Two simultaneous identical creates under one key never produce two rows.

    The client pre-check can't see the other request's uncommitted row, so the
    DB partial-unique index is the backstop: one insert wins, the other surfaces
    as a retryable 409 IDEMPOTENCY_KEY_CONFLICT (or both serialize and return
    the same row). Either way exactly one finding exists.
    """
    token = org_user["access_token"]
    project = await _create_project(client, token)
    key = "race-key-7777"

    async def _post() -> object:
        return await client.post(
            f"/projects/{project['id']}/findings",
            json=_finding_payload(),
            headers=_idem(token, key),
        )

    r1, r2 = await asyncio.gather(_post(), _post())
    # No duplicate row regardless of which way the race resolved.
    assert await _total_findings(client, token, project["id"]) == 1
    # Every non-201 must be the retryable conflict, never a 500.
    for r in (r1, r2):
        assert r.status_code in (201, 409), r.text
        if r.status_code == 409:
            assert r.json()["detail"] == "IDEMPOTENCY_KEY_CONFLICT"
    # At least one succeeded; all successes point at the same row.
    created = [r.json()["id"] for r in (r1, r2) if r.status_code == 201]
    assert created, (r1.text, r2.text)
    assert len(set(created)) == 1


# ---------------------------------------------------------------------------
# Attachments — POST /projects/{pid}/attachments/initiate
# ---------------------------------------------------------------------------


async def test_initiate_idempotent_returns_same_attachment_fresh_url(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    key = "att-key-5555"
    payload = {
        "filename": "snag.jpg",
        "size_bytes": 2048,
        "content_type": "image/jpeg",
        "content_sha256": _FIXED_SHA,
    }

    first = await client.post(
        f"/projects/{project['id']}/attachments/initiate",
        json=payload,
        headers=_idem(token, key),
    )
    assert first.status_code == 201, first.text

    second = await client.post(
        f"/projects/{project['id']}/attachments/initiate",
        json=payload,
        headers=_idem(token, key),
    )
    assert second.status_code == 201, second.text

    # Same row, but a freshly re-presigned upload URL on replay.
    assert second.json()["attachment_id"] == first.json()["attachment_id"]
    assert second.json()["storage_key"] == first.json()["storage_key"]
    assert second.json()["upload_url"].startswith("http://fake-storage/")


async def test_initiate_without_key_still_dedups_by_content(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """The pre-existing content_sha256 dedup is unchanged: a keyless re-initiate
    of the same bytes still 409s DUPLICATE_CONTENT (only one row exists)."""
    client, _fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    payload = {
        "filename": "snag.jpg",
        "size_bytes": 2048,
        "content_type": "image/jpeg",
        "content_sha256": _FIXED_SHA,
    }

    first = await client.post(
        f"/projects/{project['id']}/attachments/initiate",
        json=payload,
        headers=_auth(token),
    )
    assert first.status_code == 201, first.text

    dup = await client.post(
        f"/projects/{project['id']}/attachments/initiate",
        json=payload,
        headers=_auth(token),
    )
    assert dup.status_code == 409, dup.text
    assert dup.json()["detail"]["code"] == "DUPLICATE_CONTENT"
