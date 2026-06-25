"""Tests for restoring an older model-file version as head (F7).

Restore repoints `models.head_file_id` at a chosen version — it copies no bytes
and creates no new version row, so the immutable history is untouched and the
federated viewer manifest follows the pointer. Storage is mocked via FakeStorage;
extraction is driven to `succeeded` through the internal callback endpoint (no
real processor).
"""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.conftest import (
    VALID_IFC_HEADER,
    FakeStorage,
    _add_member,
    _audit_rows,
    _auth,
    _create_document,
    _create_project,
    _new_hash,
)

SECRET = "dev-shared-secret-change-me"  # matches Settings default


def _bearer(secret: str = SECRET) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


async def _init_complete(
    client: AsyncClient,
    fake: FakeStorage,
    org_user: dict[str, str],
    project_id: str,
    document_id: str,
    name: str,
) -> str:
    """Initiate + complete an IFC version (status ready, extraction queued)."""
    init = (
        await client.post(
            f"/projects/{project_id}/documents/{document_id}/files/initiate",
            json={
                "filename": name,
                "size_bytes": len(VALID_IFC_HEADER),
                "content_type": "application/octet-stream",
                "content_sha256": _new_hash(),
            },
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    fake.objects[init["storage_key"]] = VALID_IFC_HEADER
    complete = await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{init['file_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert complete.status_code == 200, complete.text
    return init["file_id"]


async def _succeed(
    client: AsyncClient, org_user: dict[str, str], project_id: str, file_id: str
) -> None:
    """Drive a ready file to extraction `succeeded` via the internal callback."""
    resp = await client.post(
        "/internal/jobs/callback",
        json={
            "file_id": file_id,
            "organization_id": org_user["organization_id"],
            "status": "succeeded",
            "fragments_key": f"projects/{project_id}/{file_id}.frag",
            "metadata_key": f"projects/{project_id}/{file_id}.metadata.json",
            "properties_key": f"projects/{project_id}/{file_id}.properties.json",
            "finished_at": "2026-04-29T12:00:30Z",
            "extractor_version": "0.1.0",
        },
        headers=_bearer(),
    )
    assert resp.status_code == 200, resp.text


async def _two_succeeded_versions(
    client: AsyncClient,
    fake: FakeStorage,
    org_user: dict[str, str],
    name: str = "restore",
) -> tuple[str, str, str, str]:
    """Project + model with v1, v2 both extraction-succeeded. Returns
    (project_id, document_id, v1_file_id, v2_file_id)."""
    project = await _create_project(client, org_user["access_token"], name=name + "-p")
    model = await _create_document(
        client, org_user["access_token"], project["id"], name=name + "-m"
    )
    pid, mid = project["id"], model["id"]
    v1 = await _init_complete(client, fake, org_user, pid, mid, "v1.ifc")
    await _succeed(client, org_user, pid, v1)
    v2 = await _init_complete(client, fake, org_user, pid, mid, "v2.ifc")
    await _succeed(client, org_user, pid, v2)
    return pid, mid, v1, v2


async def _restore(
    client: AsyncClient, token: str, project_id: str, document_id: str, file_id: str
) -> object:
    return await client.post(
        f"/projects/{project_id}/documents/{document_id}/files/{file_id}/restore",
        headers=_auth(token),
    )


# ---------------------------------------------------------------------------
# Happy path — repoint, create nothing
# ---------------------------------------------------------------------------


async def test_restore_repoints_head_and_creates_nothing(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    pid, mid, v1, _v2 = await _two_succeeded_versions(client, fake, org_user)

    resp = await _restore(client, org_user["access_token"], pid, mid, v1)
    assert resp.status_code == 200, resp.text
    assert resp.json()["head_file_id"] == v1

    # Document now points at v1, but the version history is untouched (still v2, v1).
    model = (
        await client.get(
            f"/projects/{pid}/documents/{mid}", headers=_auth(org_user["access_token"])
        )
    ).json()
    assert model["head_file_id"] == v1
    assert [v["version_number"] for v in model["versions"]] == [2, 1]

    files = (
        await client.get(
            f"/projects/{pid}/documents/{mid}/files?status=all",
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    assert len(files) == 2  # no new version row was minted


async def test_restore_manifest_follows_pointer(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    pid, mid, v1, _v2 = await _two_succeeded_versions(client, fake, org_user)

    # Before restore, the federated manifest serves the newest version (v2).
    before = (
        await client.get(
            f"/projects/{pid}/viewer-bundle", headers=_auth(org_user["access_token"])
        )
    ).json()
    entry = next(m for m in before["models"] if m["document_id"] == mid)
    assert entry["file_id"] == _v2

    assert (await _restore(client, org_user["access_token"], pid, mid, v1)).status_code == 200

    after = (
        await client.get(
            f"/projects/{pid}/viewer-bundle", headers=_auth(org_user["access_token"])
        )
    ).json()
    entry = next(m for m in after["models"] if m["document_id"] == mid)
    assert entry["file_id"] == v1


# ---------------------------------------------------------------------------
# Conflicts
# ---------------------------------------------------------------------------


async def test_restore_current_head_conflicts(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    pid, mid, v1, _v2 = await _two_succeeded_versions(client, fake, org_user)

    # v2 is the effective head (pointer NULL → newest) — restoring it is a no-op.
    resp = await _restore(client, org_user["access_token"], pid, mid, _v2)
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "VERSION_ALREADY_HEAD"

    # After restoring v1, restoring v1 again conflicts too.
    assert (await _restore(client, org_user["access_token"], pid, mid, v1)).status_code == 200
    again = await _restore(client, org_user["access_token"], pid, mid, v1)
    assert again.status_code == 409
    assert again.json()["detail"] == "VERSION_ALREADY_HEAD"


async def test_restore_non_succeeded_source_conflicts(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="notready-p")
    model = await _create_document(
        client, org_user["access_token"], project["id"], name="notready-m"
    )
    pid, mid = project["id"], model["id"]
    # v1 is ready but extraction never succeeded (still queued); v2 succeeds.
    v1 = await _init_complete(client, fake, org_user, pid, mid, "v1.ifc")
    v2 = await _init_complete(client, fake, org_user, pid, mid, "v2.ifc")
    await _succeed(client, org_user, pid, v2)

    resp = await _restore(client, org_user["access_token"], pid, mid, v1)
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "SOURCE_NOT_RESTORABLE"


# ---------------------------------------------------------------------------
# A new upload reclaims the head
# ---------------------------------------------------------------------------


async def test_upload_new_version_reclaims_head(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    pid, mid, v1, _v2 = await _two_succeeded_versions(client, fake, org_user)

    assert (await _restore(client, org_user["access_token"], pid, mid, v1)).status_code == 200

    # Uploading a fresh version clears the restore pointer (newest reclaims head).
    v3 = await _init_complete(client, fake, org_user, pid, mid, "v3.ifc")
    await _succeed(client, org_user, pid, v3)

    model = (
        await client.get(
            f"/projects/{pid}/documents/{mid}", headers=_auth(org_user["access_token"])
        )
    ).json()
    assert model["head_file_id"] is None

    manifest = (
        await client.get(
            f"/projects/{pid}/viewer-bundle", headers=_auth(org_user["access_token"])
        )
    ).json()
    entry = next(m for m in manifest["models"] if m["document_id"] == mid)
    assert entry["file_id"] == v3


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


async def test_restore_viewer_forbidden(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    pid, mid, v1, _v2 = await _two_succeeded_versions(client, fake, org_user)
    await _add_member(
        client, org_user["access_token"], pid, same_org_non_admin_user["id"], "viewer"
    )
    resp = await _restore(client, same_org_non_admin_user["access_token"], pid, mid, v1)
    assert resp.status_code == 403, resp.text


async def test_restore_inspector_forbidden(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    # Inspector (kwaliteitsborger) is read-only on project_file — consistent with
    # not being able to upload model versions. Documents the deliberate gate.
    client, fake = fake_storage_client
    pid, mid, v1, _v2 = await _two_succeeded_versions(client, fake, org_user)
    await _add_member(
        client, org_user["access_token"], pid, same_org_non_admin_user["id"], "inspector"
    )
    resp = await _restore(client, same_org_non_admin_user["access_token"], pid, mid, v1)
    assert resp.status_code == 403, resp.text


async def test_restore_contractor_allowed(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    pid, mid, v1, _v2 = await _two_succeeded_versions(client, fake, org_user)
    await _add_member(
        client, org_user["access_token"], pid, same_org_non_admin_user["id"], "contractor"
    )
    resp = await _restore(client, same_org_non_admin_user["access_token"], pid, mid, v1)
    assert resp.status_code == 200, resp.text
    assert resp.json()["head_file_id"] == v1


async def test_restore_cross_org_returns_404(
    org_user: dict[str, str],
    other_org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    pid, mid, v1, _v2 = await _two_succeeded_versions(client, fake, org_user)
    resp = await _restore(client, other_org_user["access_token"], pid, mid, v1)
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


async def test_restore_writes_audit_row(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    pid, mid, v1, _v2 = await _two_succeeded_versions(client, fake, org_user)
    assert (await _restore(client, org_user["access_token"], pid, mid, v1)).status_code == 200

    rows = await _audit_rows(
        session_maker, "project_file.version_restored", resource_id=v1
    )
    assert len(rows) == 1
    row = rows[0]
    assert row.project_id is not None  # required for the project activity feed
    assert row.after["restored_from_version"] == 1
    assert row.after["head_file_id"] == v1
