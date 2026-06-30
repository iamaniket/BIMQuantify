"""Phase C — viewer bundles unified onto get_scoped_session.

A free user reads BOTH the per-file viewer bundle and the federated project
manifest on the CANONICAL `/projects/...` paths (what the viewer actually
fetches); the legacy `/free/...` routes still serve the same logic during
migration; paid is unchanged.

The free file-upload flow itself still lives on free_documents.router (a
separate, more intricate slice) — here we just seed a succeeded model through it
and assert the unified READ paths.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.test_free_viewer import (
    _auth,
    _callback_succeeded,
    _create_document,
    _create_project,
    _free_token,
    _upload,
)

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from tests.conftest import FakeStorage


async def test_free_viewer_bundles_via_unified_paths(
    free_tier_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = free_tier_storage_client
    token = await _free_token(client, session_maker, "vb-free@example.com")
    pid = await _create_project(client, token)
    did = await _create_document(client, token, pid)
    file = await _upload(client, fake, token, pid, did)
    await _callback_succeeded(client, file["id"], file["storage_key"])
    fid = file["id"]

    # Per-file viewer bundle via the CANONICAL path (free branch).
    perfile = await client.get(
        f"/projects/{pid}/documents/{did}/files/{fid}/viewer-bundle",
        headers=_auth(token),
    )
    assert perfile.status_code == 200, perfile.text
    assert perfile.json()["file_type"] == "ifc"
    assert perfile.json()["fragments_url"]

    # Federated project manifest via the CANONICAL path (free branch).
    fed = await client.get(f"/projects/{pid}/viewer-bundle", headers=_auth(token))
    assert fed.status_code == 200, fed.text
    models = fed.json()["models"]
    assert len(models) == 1
    assert models[0]["model_id"] == did
    assert models[0]["fragments_url"]

    # Legacy /free routes still serve the same logic (backward compat).
    legacy_perfile = await client.get(
        f"/free/projects/{pid}/documents/{did}/files/{fid}/viewer-bundle",
        headers=_auth(token),
    )
    assert legacy_perfile.status_code == 200, legacy_perfile.text
    legacy_fed = await client.get(f"/free/projects/{pid}/viewer-bundle", headers=_auth(token))
    assert legacy_fed.status_code == 200
    assert len(legacy_fed.json()["models"]) == 1


async def test_paid_federated_bundle_unchanged(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """A paid user still hits /projects/{id}/viewer-bundle (the unified router's
    paid branch); an empty project yields an empty manifest."""
    proj = await client.post(
        "/projects", json={"name": "Paid VB"}, headers=_auth(org_user["access_token"])
    )
    assert proj.status_code == 201, proj.text
    pid = proj.json()["id"]
    fed = await client.get(
        f"/projects/{pid}/viewer-bundle", headers=_auth(org_user["access_token"])
    )
    assert fed.status_code == 200
    assert fed.json()["models"] == []
