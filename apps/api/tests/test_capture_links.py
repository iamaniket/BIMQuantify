"""Integration tests for capture links (authenticated CRUD + public upload).

Storage is mocked via dependency override so tests run without MinIO.
Shared fixtures (FakeStorage, fake_storage_client, _auth, _create_project,
_add_member, _new_hash) live in conftest.py.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest

from tests.conftest import (
    FakeStorage,
    _add_member,
    _auth,
    _create_project,
    _latest_audit,
    _new_hash,
)

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def _capture_upload_payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "filename": "site-photo.jpg",
        "size_bytes": 4096,
        "content_type": "image/jpeg",
        "content_sha256": _new_hash(),
    }
    base.update(overrides)
    return base


async def _create_capture_link(
    client: AsyncClient,
    token: str,
    project_id: str,
    **overrides: object,
) -> dict:
    payload: dict[str, object] = {"label": "Test link", "ttl_hours": 24}
    payload.update(overrides)
    resp = await client.post(
        f"/projects/{project_id}/capture-links",
        json=payload,
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Authenticated — Create / List / Revoke
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_capture_link(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    assert "token" in link
    assert "url" in link
    assert link["label"] == "Test link"
    assert link["max_uses"] is None


@pytest.mark.asyncio
async def test_create_capture_link_emits_audit(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    await _create_capture_link(client, org_user["access_token"], project["id"])
    row = await _latest_audit(session_maker, "capture_link.created")
    assert row is not None
    assert row.resource_type == "capture_links"
    assert row.after is not None
    assert row.after["label"] == "Test link"
    assert "token" not in row.after, "Token must be redacted from audit"


@pytest.mark.asyncio
async def test_list_capture_links(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    await _create_capture_link(client, org_user["access_token"], project["id"])
    await _create_capture_link(client, org_user["access_token"], project["id"], label="Link 2")
    resp = await client.get(
        f"/projects/{project['id']}/capture-links",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_revoke_capture_link(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    resp = await client.delete(
        f"/projects/{project['id']}/capture-links/{link['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_revoke_emits_audit(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    await client.delete(
        f"/projects/{project['id']}/capture-links/{link['id']}",
        headers=_auth(org_user["access_token"]),
    )
    row = await _latest_audit(session_maker, "capture_link.revoked")
    assert row is not None
    assert row.resource_type == "capture_links"
    assert row.before is not None
    assert row.after is not None
    assert row.after["revoked_at"] is not None


@pytest.mark.asyncio
async def test_revoke_already_revoked_returns_409(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    await client.delete(
        f"/projects/{project['id']}/capture-links/{link['id']}",
        headers=_auth(org_user["access_token"]),
    )
    resp = await client.delete(
        f"/projects/{project['id']}/capture-links/{link['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_viewer_cannot_create_capture_link(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "viewer",
    )
    resp = await client.post(
        f"/projects/{project['id']}/capture-links",
        json={"label": "Nope", "ttl_hours": 24},
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_can_list_capture_links(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    await _create_capture_link(client, org_user["access_token"], project["id"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "viewer",
    )
    resp = await client.get(
        f"/projects/{project['id']}/capture-links",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Public endpoints — validate / initiate / complete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_public_validate_token(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    org_id = org_user["organization_id"]
    resp = await client.get(f"/public/capture/{org_id}/{link['token']}/validate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["project_name"] is not None
    assert body["label"] == "Test link"


@pytest.mark.asyncio
async def test_public_validate_invalid_token_404(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    await _create_project(client, org_user["access_token"])
    org_id = org_user["organization_id"]
    resp = await client.get(f"/public/capture/{org_id}/nonexistenttoken/validate")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_public_validate_invalid_org_404(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    resp = await client.get(f"/public/capture/{uuid4()}/{link['token']}/validate")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_public_initiate_upload(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    org_id = org_user["organization_id"]
    resp = await client.post(
        f"/public/capture/{org_id}/{link['token']}/initiate",
        json=_capture_upload_payload(),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert "upload_url" in body
    assert "attachment_id" in body
    assert body["storage_key"].endswith(".jpg")


@pytest.mark.asyncio
async def test_public_initiate_emits_audit_without_user(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    org_id = org_user["organization_id"]
    await client.post(
        f"/public/capture/{org_id}/{link['token']}/initiate",
        json=_capture_upload_payload(),
    )
    row = await _latest_audit(session_maker, "attachment.initiated")
    assert row is not None
    assert row.user_id is None
    assert row.after is not None
    assert "capture_link_id" in row.after


@pytest.mark.asyncio
async def test_public_initiate_concurrent_respects_max_uses(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """A `max_uses=1` link hit by two simultaneous uploads must be consumed
    exactly once. `initiate` loads the link FOR UPDATE, so the
    is_exhausted-check + use_count increment serialize: one upload lands (201),
    the other sees the now-exhausted link (410 CAPTURE_LINK_EXHAUSTED). The two
    requests carry distinct content hashes so this exercises the use_count race,
    not content de-dup. Without the row lock both reads see use_count=0, both
    pass, and a single-use link is consumed twice — on an UNAUTHENTICATED
    endpoint.
    """
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(
        client, org_user["access_token"], project["id"], max_uses=1
    )
    org_id = org_user["organization_id"]

    async def _initiate() -> object:
        return await client.post(
            f"/public/capture/{org_id}/{link['token']}/initiate",
            json=_capture_upload_payload(content_sha256=_new_hash()),
        )

    r1, r2 = await asyncio.gather(_initiate(), _initiate())

    statuses = sorted([r1.status_code, r2.status_code])
    assert statuses == [201, 410], (r1.text, r2.text)
    loser = r1 if r1.status_code == 410 else r2
    assert loser.json()["detail"] == "CAPTURE_LINK_EXHAUSTED"


@pytest.mark.asyncio
async def test_public_complete_upload(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    org_id = org_user["organization_id"]
    initiated = (
        await client.post(
            f"/public/capture/{org_id}/{link['token']}/initiate",
            json=_capture_upload_payload(),
        )
    ).json()
    fake.objects[initiated["storage_key"]] = b"x" * 4096
    resp = await client.post(
        f"/public/capture/{org_id}/{link['token']}/complete/{initiated['attachment_id']}",
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_public_complete_emits_audit(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    org_id = org_user["organization_id"]
    initiated = (
        await client.post(
            f"/public/capture/{org_id}/{link['token']}/initiate",
            json=_capture_upload_payload(),
        )
    ).json()
    fake.objects[initiated["storage_key"]] = b"x" * 4096
    await client.post(
        f"/public/capture/{org_id}/{link['token']}/complete/{initiated['attachment_id']}",
    )
    row = await _latest_audit(session_maker, "attachment.completed")
    assert row is not None
    assert row.user_id is None


@pytest.mark.asyncio
async def test_public_revoked_link_returns_410(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    await client.delete(
        f"/projects/{project['id']}/capture-links/{link['id']}",
        headers=_auth(org_user["access_token"]),
    )
    org_id = org_user["organization_id"]
    resp = await client.get(f"/public/capture/{org_id}/{link['token']}/validate")
    assert resp.status_code == 410
    assert resp.json()["detail"] == "CAPTURE_LINK_REVOKED"


@pytest.mark.asyncio
async def test_public_exhausted_link_returns_410(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(
        client, org_user["access_token"], project["id"], max_uses=1
    )
    org_id = org_user["organization_id"]
    initiated = (
        await client.post(
            f"/public/capture/{org_id}/{link['token']}/initiate",
            json=_capture_upload_payload(),
        )
    ).json()
    fake.objects[initiated["storage_key"]] = b"x" * 4096
    await client.post(
        f"/public/capture/{org_id}/{link['token']}/complete/{initiated['attachment_id']}",
    )
    resp = await client.get(f"/public/capture/{org_id}/{link['token']}/validate")
    assert resp.status_code == 410
    assert resp.json()["detail"] == "CAPTURE_LINK_EXHAUSTED"


@pytest.mark.asyncio
async def test_public_validate_shows_remaining_uses(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(
        client, org_user["access_token"], project["id"], max_uses=5
    )
    org_id = org_user["organization_id"]
    resp = await client.get(f"/public/capture/{org_id}/{link['token']}/validate")
    assert resp.status_code == 200
    assert resp.json()["remaining_uses"] == 5


@pytest.mark.asyncio
async def test_public_initiate_rejects_bad_extension(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    org_id = org_user["organization_id"]
    resp = await client.post(
        f"/public/capture/{org_id}/{link['token']}/initiate",
        json=_capture_upload_payload(filename="hack.exe"),
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Public capture — capture metadata
# ---------------------------------------------------------------------------

_SAMPLE_METADATA: dict[str, object] = {
    "captured_at": "2026-05-27T10:30:00.000Z",
    "capture_method": "camera",
    "device": {"user_agent": "MobileTestAgent/1.0"},
    "geolocation": {
        "latitude": 52.0907,
        "longitude": 5.1214,
        "accuracy": 8.0,
        "low_accuracy": False,
    },
    "exif": {
        "make": "Samsung",
        "model": "Galaxy S24",
        "orientation": 1,
    },
}


@pytest.mark.asyncio
async def test_public_capture_with_metadata(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    org_id = org_user["organization_id"]
    payload = _capture_upload_payload(capture_metadata=_SAMPLE_METADATA)
    initiated = (
        await client.post(
            f"/public/capture/{org_id}/{link['token']}/initiate",
            json=payload,
        )
    ).json()
    fake.objects[initiated["storage_key"]] = b"x" * 4096
    await client.post(
        f"/public/capture/{org_id}/{link['token']}/complete/{initiated['attachment_id']}",
    )
    detail = await client.get(
        f"/projects/{project['id']}/attachments/{initiated['attachment_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert detail.status_code == 200
    meta = detail.json()["capture_metadata"]
    assert meta is not None
    assert meta["capture_method"] == "camera"
    assert meta["geolocation"]["latitude"] == 52.0907
    assert meta["exif"]["make"] == "Samsung"
    assert "server_received_at" in meta


@pytest.mark.asyncio
async def test_public_capture_without_metadata(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    link = await _create_capture_link(client, org_user["access_token"], project["id"])
    org_id = org_user["organization_id"]
    initiated = (
        await client.post(
            f"/public/capture/{org_id}/{link['token']}/initiate",
            json=_capture_upload_payload(),
        )
    ).json()
    fake.objects[initiated["storage_key"]] = b"x" * 4096
    await client.post(
        f"/public/capture/{org_id}/{link['token']}/complete/{initiated['attachment_id']}",
    )
    detail = await client.get(
        f"/projects/{project['id']}/attachments/{initiated['attachment_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert detail.status_code == 200
    assert detail.json()["capture_metadata"] is None
