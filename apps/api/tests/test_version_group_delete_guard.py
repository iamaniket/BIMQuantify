"""M-db3 — version-group root-delete guard (attachments + certificates).

Attachments and certificates version by ``coalesce(parent_*, id)``. Deleting a
lineage root while newer versions still chain to it would orphan the version
display (and, were these ever hard deletes, the SET NULL re-key could collide the
version-group unique index). The delete endpoints now refuse it with a 409 — you
delete newest-first.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import text

from tests.conftest import (
    _auth,
    _create_attachment_row,
    _create_project,
    _provision_user_in_org,
    _schema_for_project,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker


async def _insert_attachment_version(project_id: str, parent_id: str, version: int) -> str:
    """Insert a child attachment version (parent_file_id = the lineage root)."""
    from bimdossier_api.db import get_session_maker

    aid = str(uuid4())
    async with get_session_maker()() as s, s.begin():
        target = await _schema_for_project(s, project_id)
        await s.execute(
            text(
                f'INSERT INTO "{target}".project_files '
                "(id, project_id, role, status, storage_key, original_filename, "
                " size_bytes, content_type, version_number, parent_file_id) "
                "VALUES (:id, :pid, 'attachment', 'ready', :sk, 'photo.jpg', "
                "100, 'image/jpeg', :vn, :parent)"
            ),
            {
                "id": aid,
                "pid": project_id,
                "sk": f"attachments/{aid}.jpg",
                "vn": version,
                "parent": parent_id,
            },
        )
    return aid


async def _insert_certificate(project_id: str, version: int, parent_id: str | None = None) -> str:
    from bimdossier_api.db import get_session_maker

    cid = str(uuid4())
    async with get_session_maker()() as s, s.begin():
        target = await _schema_for_project(s, project_id)
        await s.execute(
            text(
                f'INSERT INTO "{target}".certificates '
                "(id, project_id, certificate_type, status, storage_key, original_filename, "
                " size_bytes, content_type, version_number, parent_certificate_id) "
                "VALUES (:id, :pid, 'product', 'ready', :sk, 'cert.pdf', "
                "100, 'application/pdf', :vn, :parent)"
            ),
            {
                "id": cid,
                "pid": project_id,
                "sk": f"certificates/{cid}.pdf",
                "vn": version,
                "parent": parent_id,
            },
        )
    return cid


async def test_cannot_delete_attachment_root_with_child_versions(
    fake_storage_client: tuple,
    session_maker: async_sessionmaker,
    engine: AsyncEngine,
) -> None:
    client, _ = fake_storage_client
    user = await _provision_user_in_org(
        client, session_maker, engine, email="att@x.test", organization_name="AttOrg"
    )
    project = await _create_project(client, user["access_token"], name="P")
    root = await _create_attachment_row(project["id"])  # v1, parent NULL
    child = await _insert_attachment_version(project["id"], root, 2)

    base = f"/projects/{project['id']}/attachments"
    headers = _auth(user["access_token"])

    # Deleting the root while a live child version exists is blocked.
    blocked = await client.delete(f"{base}/{root}", headers=headers)
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"] == "FILE_VERSION_HAS_DESCENDANTS"

    # The leaf (newest) version deletes fine...
    leaf = await client.delete(f"{base}/{child}", headers=headers)
    assert leaf.status_code == 204, leaf.text

    # ...and now the root has no live children, so it deletes too.
    root_del = await client.delete(f"{base}/{root}", headers=headers)
    assert root_del.status_code == 204, root_del.text


async def test_cannot_delete_certificate_root_with_child_versions(
    fake_storage_client: tuple,
    session_maker: async_sessionmaker,
    engine: AsyncEngine,
) -> None:
    client, _ = fake_storage_client
    user = await _provision_user_in_org(
        client, session_maker, engine, email="cert@x.test", organization_name="CertOrg"
    )
    project = await _create_project(client, user["access_token"], name="P")
    root = await _insert_certificate(project["id"], 1)
    child = await _insert_certificate(project["id"], 2, parent_id=root)

    base = f"/projects/{project['id']}/certificates"
    headers = _auth(user["access_token"])

    blocked = await client.delete(f"{base}/{root}", headers=headers)
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"] == "FILE_VERSION_HAS_DESCENDANTS"

    leaf = await client.delete(f"{base}/{child}", headers=headers)
    assert leaf.status_code == 204, leaf.text

    root_del = await client.delete(f"{base}/{root}", headers=headers)
    assert root_del.status_code == 204, root_del.text
