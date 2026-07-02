"""Tests for free-tier attachments (photo evidence on free snags) + the photo
links on free findings, plus the single-finding GET.

Covers: the two-phase presigned upload (initiate → stage → complete → download),
idempotent replay, attaching photos to a snag at create + resolution evidence at
update (with the read model surfacing them), the single GET, the
attachment-not-found validation when linking a stranger's id, and the RLS gate —
a second free user can't reach another's attachment.
"""

import hashlib
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from tests.conftest import FakeStorage
from tests.test_pooled_viewer import (
    _auth,
    _create_document,
    _create_project,
    _free_token,
)

_PHOTO_BYTES = b"\xff\xd8\xff\xe0fake-jpeg-bytes-for-the-test\xff\xd9"


def _sha(seed: str) -> str:
    return hashlib.sha256(seed.encode()).hexdigest()


async def _upload_attachment(
    client: AsyncClient,
    fake: FakeStorage,
    token: str,
    project_id: str,
    *,
    filename: str = "snag.jpg",
    content_type: str = "image/jpeg",
    idempotency_key: str | None = None,
) -> dict:
    """initiate → stage bytes (matching declared size) → complete. Returns the
    completed PooledAttachmentRead."""
    headers = _auth(token)
    if idempotency_key is not None:
        headers = {**headers, "Idempotency-Key": idempotency_key}
    init = await client.post(
        f"/pooled/projects/{project_id}/attachments/initiate",
        json={
            "filename": filename,
            "size_bytes": len(_PHOTO_BYTES),
            "content_type": content_type,
            "content_sha256": _sha(filename),
        },
        headers=headers,
    )
    assert init.status_code == 201, init.text
    body = init.json()
    fake.objects[body["storage_key"]] = _PHOTO_BYTES
    done = await client.post(
        f"/pooled/projects/{project_id}/attachments/{body['attachment_id']}/complete",
        headers=_auth(token),
    )
    assert done.status_code == 200, done.text
    return {**done.json(), "storage_key": body["storage_key"], "upload_url": body["upload_url"]}


async def _create_finding(
    client: AsyncClient, token: str, document_id: str, *, photo_ids: list[str] | None = None
) -> dict:
    payload: dict[str, object] = {"title": "Crack in wall", "severity": "high"}
    if photo_ids is not None:
        payload["photo_ids"] = photo_ids
    resp = await client.post(
        f"/pooled/documents/{document_id}/findings", json=payload, headers=_auth(token)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_free_attachment_upload_and_download(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-att@example.com")
    pid = await _create_project(client, token)

    att = await _upload_attachment(client, fake, token, pid)
    assert att["status"] == "ready"
    assert att["attachment_category"] == "image"
    assert att["pooled_project_id"] == pid
    # Key is scoped to the owner's free prefix.
    assert att["storage_key"].startswith("free/")
    assert "/attachments/" in att["storage_key"]

    dl = await client.get(
        f"/pooled/projects/{pid}/attachments/{att['id']}/download", headers=_auth(token)
    )
    assert dl.status_code == 200, dl.text
    assert dl.json()["download_url"]


async def test_pooled_attachment_idempotent_replay_returns_same_row(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-att-idem@example.com")
    pid = await _create_project(client, token)

    key = str(uuid4())
    first = await client.post(
        f"/pooled/projects/{pid}/attachments/initiate",
        json={
            "filename": "p.jpg",
            "size_bytes": len(_PHOTO_BYTES),
            "content_type": "image/jpeg",
            "content_sha256": _sha("p.jpg"),
        },
        headers={**_auth(token), "Idempotency-Key": key},
    )
    assert first.status_code == 201, first.text
    second = await client.post(
        f"/pooled/projects/{pid}/attachments/initiate",
        json={
            "filename": "p.jpg",
            "size_bytes": len(_PHOTO_BYTES),
            "content_type": "image/jpeg",
            "content_sha256": _sha("p.jpg"),
        },
        headers={**_auth(token), "Idempotency-Key": key},
    )
    assert second.status_code == 201, second.text
    # Same row, fresh presigned URL.
    assert first.json()["attachment_id"] == second.json()["attachment_id"]


async def test_free_finding_create_with_photo_then_get_and_list(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-snag-photo@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)

    att = await _upload_attachment(client, fake, token, pid)
    finding = await _create_finding(client, token, did, photo_ids=[att["id"]])
    assert finding["photo_ids"] == [att["id"]]

    # Single GET (mobile useFinding / offline conflict refetch) surfaces it.
    got = await client.get(f"/pooled/findings/{finding['id']}", headers=_auth(token))
    assert got.status_code == 200, got.text
    assert got.json()["photo_ids"] == [att["id"]]

    # The document findings list also carries the photo link.
    listed = await client.get(f"/pooled/documents/{did}/findings", headers=_auth(token))
    assert listed.status_code == 200, listed.text
    rows = listed.json()
    assert len(rows) == 1
    assert rows[0]["photo_ids"] == [att["id"]]


async def test_free_finding_update_adds_resolution_evidence(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-snag-evidence@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)

    att = await _upload_attachment(client, fake, token, pid)
    finding = await _create_finding(client, token, did)
    assert finding["resolution_evidence_ids"] is None

    patched = await client.patch(
        f"/pooled/findings/{finding['id']}",
        json={"status": "resolved", "resolution_evidence_ids": [att["id"]]},
        headers=_auth(token),
    )
    assert patched.status_code == 200, patched.text
    data = patched.json()
    assert data["status"] == "resolved"
    assert data["resolution_evidence_ids"] == [att["id"]]


async def test_free_finding_create_with_unknown_photo_id_422(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-snag-bad@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)

    resp = await client.post(
        f"/pooled/documents/{did}/findings",
        json={"title": "x", "severity": "low", "photo_ids": [str(uuid4())]},
        headers=_auth(token),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "FREE_ATTACHMENT_NOT_FOUND"


async def test_pooled_attachment_download_neutralizes_spoofed_content_type(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """POOL-XSS-1: a `.txt` initiated declaring `text/html` is served back with the
    canonical `text/plain` and forced to `attachment` even when inline is asked —
    so uploaded HTML can never execute inline on the shared storage origin."""
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-xss@example.com")
    pid = await _create_project(client, token)

    att = await _upload_attachment(
        client, fake, token, pid, filename="note.txt", content_type="text/html"
    )
    dl = await client.get(
        f"/pooled/projects/{pid}/attachments/{att['id']}/download?disposition=inline",
        headers=_auth(token),
    )
    assert dl.status_code == 200, dl.text
    url = dl.json()["download_url"]
    assert "content_type=text/plain" in url
    assert "disposition=attachment" in url


async def test_pooled_attachment_image_download_stays_inline(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Images keep inline preview (the snag-photo gallery) with a canonical type."""
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "free-img@example.com")
    pid = await _create_project(client, token)

    att = await _upload_attachment(client, fake, token, pid)  # snag.jpg / image/jpeg
    dl = await client.get(
        f"/pooled/projects/{pid}/attachments/{att['id']}/download?disposition=inline",
        headers=_auth(token),
    )
    assert dl.status_code == 200, dl.text
    url = dl.json()["download_url"]
    assert "content_type=image/jpeg" in url
    assert "disposition=inline" in url


async def test_free_attachment_cross_owner_isolation(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A second free user (running as bim_app under RLS) can't reach another
    user's attachment — the project isn't visible to them."""
    client, fake = free_tier_storage_client
    token_a = await _free_token(client, session_maker, "free-att-a@example.com")
    pid_a = await _create_project(client, token_a)
    att = await _upload_attachment(client, fake, token_a, pid_a)

    token_b = await _free_token(client, session_maker, "free-att-b@example.com")
    dl = await client.get(
        f"/pooled/projects/{pid_a}/attachments/{att['id']}/download",
        headers=_auth(token_b),
    )
    assert dl.status_code == 404, dl.text


# ---------------------------------------------------------------------------
# FSL-1 — attachment (photo) bytes count toward the aggregate free storage
# cap, so a free user can't bypass the ceiling with unbounded evidence, and the
# displayed usage reflects them.
# ---------------------------------------------------------------------------


async def test_free_attachment_initiate_respects_storage_cap(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _ = free_tier_storage_client
    token = await _free_token(client, session_maker, "fsl1-cap@example.com")
    pid = await _create_project(client, token)

    # Squeeze the aggregate cap below the photo size so the next attachment trips
    # it (per-request get_settings() reloads after the cache clear).
    monkeypatch.setenv("FREE_STORAGE_MAX_BYTES", str(len(_PHOTO_BYTES) - 1))
    get_settings.cache_clear()

    init = await client.post(
        f"/pooled/projects/{pid}/attachments/initiate",
        json={
            "filename": "snag.jpg",
            "size_bytes": len(_PHOTO_BYTES),
            "content_type": "image/jpeg",
            "content_sha256": _sha("snag.jpg"),
        },
        headers=_auth(token),
    )
    assert init.status_code == 413, init.text
    assert init.json()["detail"] == "FREE_STORAGE_CAP_REACHED"


async def test_free_usage_includes_attachment_bytes(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "fsl1-usage@example.com")
    pid = await _create_project(client, token)
    await _upload_attachment(client, fake, token, pid)

    usage = await client.get("/pooled/account/usage", headers=_auth(token))
    assert usage.status_code == 200, usage.text
    assert usage.json()["storage_bytes_used"] >= len(_PHOTO_BYTES)
