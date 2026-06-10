"""Integration tests for project certificate storage (proof-of-conformity).

Storage is mocked via dependency override so tests run without MinIO.
Mirrors test_attachments.py; the certificate-specific surface is the structured
conformity metadata (type/number/issuer/validity) and the expiry filter that
unblocks the #N6 expiry-warning feature.
"""

from __future__ import annotations

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


def _cert_payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "filename": "ce-cert.pdf",
        "size_bytes": 4096,
        "content_type": "application/pdf",
        "content_sha256": _new_hash(),
        "certificate_type": "product",
    }
    base.update(overrides)
    return base


async def _initiate_cert(
    client: AsyncClient,
    token: str,
    project_id: str,
    **overrides: object,
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/certificates/initiate",
        json=_cert_payload(**overrides),
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _complete_cert(
    client: AsyncClient,
    fake: FakeStorage,
    token: str,
    project_id: str,
    cert: dict,
    size: int = 4096,
) -> dict:
    fake.objects[cert["storage_key"]] = b"x" * size
    resp = await client.post(
        f"/projects/{project_id}/certificates/{cert['certificate_id']}/complete",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Initiate / Complete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_initiate_succeeds(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    body = await _initiate_cert(client, org_user["access_token"], project["id"])
    assert body["upload_url"].startswith("http://fake-storage/")
    assert body["storage_key"].startswith(f"projects/{project['id']}/certificates/")
    assert body["storage_key"].endswith(".pdf")
    assert "certificate_id" in body
    assert body["expires_in"] == fake.presign_ttl_value


@pytest.mark.asyncio
async def test_initiate_rejects_bad_extension(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/certificates/initiate",
        json=_cert_payload(filename="virus.exe"),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "INVALID_FILE_EXTENSION"


@pytest.mark.asyncio
async def test_initiate_persists_structured_metadata(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    cert = await _initiate_cert(
        client,
        org_user["access_token"],
        project["id"],
        certificate_type="installation_test",
        certificate_number="DOP-2026-0042",
        issuer="Kiwa",
        subject="Brandwerende doorvoeringen begane grond",
        valid_from="2026-01-01",
        valid_until="2031-01-01",
    )
    detail = await client.get(
        f"/projects/{project['id']}/certificates/{cert['certificate_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert detail.status_code == 200
    body = detail.json()
    assert body["certificate_type"] == "installation_test"
    assert body["certificate_number"] == "DOP-2026-0042"
    assert body["issuer"] == "Kiwa"
    assert body["valid_from"] == "2026-01-01"
    assert body["valid_until"] == "2031-01-01"


@pytest.mark.asyncio
async def test_initiate_rejects_inverted_validity_window(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.post(
        f"/projects/{project['id']}/certificates/initiate",
        json=_cert_payload(valid_from="2030-01-01", valid_until="2020-01-01"),
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_complete_sets_ready(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    cert = await _initiate_cert(client, org_user["access_token"], project["id"])
    body = await _complete_cert(client, fake, org_user["access_token"], project["id"], cert)
    assert body["status"] == "ready"


@pytest.mark.asyncio
async def test_complete_rejects_size_mismatch(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    cert = await _initiate_cert(client, org_user["access_token"], project["id"])
    fake.objects[cert["storage_key"]] = b"x" * 99
    resp = await client.post(
        f"/projects/{project['id']}/certificates/{cert['certificate_id']}/complete",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "SIZE_MISMATCH"


@pytest.mark.asyncio
async def test_initiate_emits_audit(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    await _initiate_cert(client, org_user["access_token"], project["id"], issuer="Kiwa")
    row = await _latest_audit(session_maker, "certificate.initiated")
    assert row is not None
    assert row.resource_type == "certificates"
    assert row.after is not None
    assert row.after["certificate_type"] == "product"
    assert row.after["issuer"] == "Kiwa"


# ---------------------------------------------------------------------------
# List / filters
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_returns_only_ready(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    ready = await _initiate_cert(client, org_user["access_token"], project["id"])
    await _complete_cert(client, fake, org_user["access_token"], project["id"], ready)
    await _initiate_cert(client, org_user["access_token"], project["id"])  # left pending
    resp = await client.get(
        f"/projects/{project['id']}/certificates",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["status"] == "ready"


@pytest.mark.asyncio
async def test_list_filters_by_type(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    prod = await _initiate_cert(client, token, project["id"], certificate_type="product")
    await _complete_cert(client, fake, token, project["id"], prod)
    warr = await _initiate_cert(client, token, project["id"], certificate_type="warranty")
    await _complete_cert(client, fake, token, project["id"], warr)
    resp = await client.get(
        f"/projects/{project['id']}/certificates?certificate_type=warranty",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["certificate_type"] == "warranty"


async def _seed_expiry_set(
    client: AsyncClient, fake: FakeStorage, token: str, project_id: str
) -> None:
    """One expired, one future, one never-expires certificate."""
    expired = await _initiate_cert(client, token, project_id, valid_until="2020-01-01")
    await _complete_cert(client, fake, token, project_id, expired)
    future = await _initiate_cert(client, token, project_id, valid_until="2030-01-01")
    await _complete_cert(client, fake, token, project_id, future)
    never = await _initiate_cert(client, token, project_id, valid_until=None)
    await _complete_cert(client, fake, token, project_id, never)


@pytest.mark.asyncio
async def test_list_expired_filter(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _seed_expiry_set(client, fake, token, project["id"])
    resp = await client.get(
        f"/projects/{project['id']}/certificates?expired=true",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["valid_until"] == "2020-01-01"


@pytest.mark.asyncio
async def test_list_expiring_before_filter(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _seed_expiry_set(client, fake, token, project["id"])
    # Only the 2020 cert expires on/before 2027; the 2030 and never-expires
    # certs are excluded.
    resp = await client.get(
        f"/projects/{project['id']}/certificates?expiring_before=2027-01-01",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["valid_until"] == "2020-01-01"


# ---------------------------------------------------------------------------
# Update / Delete / Download
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_metadata(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    cert = await _initiate_cert(client, org_user["access_token"], project["id"])
    resp = await client.patch(
        f"/projects/{project['id']}/certificates/{cert['certificate_id']}",
        json={"issuer": "SKG-IKOB", "valid_until": "2029-12-31"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["issuer"] == "SKG-IKOB"
    assert body["valid_until"] == "2029-12-31"


@pytest.mark.asyncio
async def test_delete_soft_deletes(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    cert = await _initiate_cert(client, org_user["access_token"], project["id"])
    resp = await client.delete(
        f"/projects/{project['id']}/certificates/{cert['certificate_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 204
    after = await client.get(
        f"/projects/{project['id']}/certificates/{cert['certificate_id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert after.status_code == 404


@pytest.mark.asyncio
async def test_download_returns_presigned_url(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    cert = await _initiate_cert(client, org_user["access_token"], project["id"])
    await _complete_cert(client, fake, org_user["access_token"], project["id"], cert)
    resp = await client.get(
        f"/projects/{project['id']}/certificates/{cert['certificate_id']}/download",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 200
    assert "download_url" in resp.json()


# ---------------------------------------------------------------------------
# Cross-project isolation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_certificate_is_project_scoped_404_across_projects(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    token = org_user["access_token"]
    project_a = await _create_project(client, token, name="A")
    project_b = await _create_project(client, token, name="B")
    cert = await _initiate_cert(client, token, project_a["id"])
    # Same org, but the certificate belongs to project A — fetching it through
    # project B must 404 (the loader filters on project_id).
    resp = await client.get(
        f"/projects/{project_b['id']}/certificates/{cert['certificate_id']}",
        headers=_auth(token),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_client_cannot_create_certificate(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client, org_user["access_token"], project["id"], same_org_non_admin_user["id"], "client"
    )
    resp = await client.post(
        f"/projects/{project['id']}/certificates/initiate",
        json=_cert_payload(),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_create_certificate(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client, org_user["access_token"], project["id"], same_org_non_admin_user["id"], "viewer"
    )
    resp = await client.post(
        f"/projects/{project['id']}/certificates/initiate",
        json=_cert_payload(),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_contractor_can_create_certificate(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    # The subcontractor (contractor role) owns his proof-of-conformity uploads.
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    await _add_member(
        client,
        org_user["access_token"],
        project["id"],
        same_org_non_admin_user["id"],
        "contractor",
    )
    resp = await client.post(
        f"/projects/{project['id']}/certificates/initiate",
        json=_cert_payload(),
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_viewer_can_list_certificates(
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    cert = await _initiate_cert(client, org_user["access_token"], project["id"])
    await _complete_cert(client, fake, org_user["access_token"], project["id"], cert)
    await _add_member(
        client, org_user["access_token"], project["id"], same_org_non_admin_user["id"], "viewer"
    )
    resp = await client.get(
        f"/projects/{project['id']}/certificates",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_get_nonexistent_certificate_404(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    project = await _create_project(client, org_user["access_token"])
    resp = await client.get(
        f"/projects/{project['id']}/certificates/{uuid4()}",
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Immutable versioning (#35)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_supersede_creates_new_version(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Re-uploading with supersedes_id mints version 2 in the same group, pointing
    its parent at the v1 root — never overwriting v1's row or bytes."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)

    v1_init = await _initiate_cert(client, token, project["id"])
    v1 = await _complete_cert(client, fake, token, project["id"], v1_init)
    assert v1["version_number"] == 1
    assert v1["parent_certificate_id"] is None

    v2_init = await _initiate_cert(
        client, token, project["id"], supersedes_id=v1_init["certificate_id"]
    )
    v2 = await _complete_cert(client, fake, token, project["id"], v2_init)
    assert v2["version_number"] == 2
    assert v2["parent_certificate_id"] == v1_init["certificate_id"]
    # Distinct immutable rows + distinct storage keys.
    assert v2["id"] != v1["id"]
    assert v2_init["storage_key"] != v1_init["storage_key"]


@pytest.mark.asyncio
async def test_list_returns_head_only(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    v1_init = await _initiate_cert(client, token, project["id"])
    await _complete_cert(client, fake, token, project["id"], v1_init)
    v2_init = await _initiate_cert(
        client, token, project["id"], supersedes_id=v1_init["certificate_id"]
    )
    await _complete_cert(client, fake, token, project["id"], v2_init)

    resp = await client.get(
        f"/projects/{project['id']}/certificates", headers=_auth(token)
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["id"] == v2_init["certificate_id"]
    assert items[0]["version_number"] == 2


@pytest.mark.asyncio
async def test_versions_endpoint_returns_history_newest_first(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    v1_init = await _initiate_cert(client, token, project["id"])
    await _complete_cert(client, fake, token, project["id"], v1_init)
    v2_init = await _initiate_cert(
        client, token, project["id"], supersedes_id=v1_init["certificate_id"]
    )
    await _complete_cert(client, fake, token, project["id"], v2_init)

    # Queryable through any version in the group (here the v1 root).
    resp = await client.get(
        f"/projects/{project['id']}/certificates/{v1_init['certificate_id']}/versions",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert [i["version_number"] for i in items] == [2, 1]
    # Both versions remain individually retrievable.
    for cid in (v1_init["certificate_id"], v2_init["certificate_id"]):
        dl = await client.get(
            f"/projects/{project['id']}/certificates/{cid}/download",
            headers=_auth(token),
        )
        assert dl.status_code == 200


@pytest.mark.asyncio
async def test_soft_deleting_head_exposes_prior_version(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    v1_init = await _initiate_cert(client, token, project["id"])
    await _complete_cert(client, fake, token, project["id"], v1_init)
    v2_init = await _initiate_cert(
        client, token, project["id"], supersedes_id=v1_init["certificate_id"]
    )
    await _complete_cert(client, fake, token, project["id"], v2_init)

    await client.delete(
        f"/projects/{project['id']}/certificates/{v2_init['certificate_id']}",
        headers=_auth(token),
    )
    resp = await client.get(
        f"/projects/{project['id']}/certificates", headers=_auth(token)
    )
    items = resp.json()
    assert len(items) == 1
    assert items[0]["id"] == v1_init["certificate_id"]
    assert items[0]["version_number"] == 1


@pytest.mark.asyncio
async def test_version_added_emits_audit(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    v1_init = await _initiate_cert(client, token, project["id"])
    await _complete_cert(client, fake, token, project["id"], v1_init)
    v2_init = await _initiate_cert(
        client, token, project["id"], supersedes_id=v1_init["certificate_id"]
    )
    await _complete_cert(client, fake, token, project["id"], v2_init)

    row = await _latest_audit(session_maker, "certificate.version_added")
    assert row is not None
    assert row.resource_type == "certificates"
    assert row.after is not None
    assert row.after["version_number"] == 2


@pytest.mark.asyncio
async def test_supersede_unknown_certificate_404(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    client, _ = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token)
    resp = await client.post(
        f"/projects/{project['id']}/certificates/initiate",
        json=_cert_payload(supersedes_id=str(uuid4())),
        headers=_auth(token),
    )
    assert resp.status_code == 404

