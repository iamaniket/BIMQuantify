from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_create_project_returns_owner_and_creates_membership(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    response = await client.post(
        "/projects",
        json={"name": "Roof Plan", "description": "high-rise"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "Roof Plan"
    assert body["description"] == "high-rise"
    assert body["thumbnail_url"] is None
    assert body["owner_id"] == org_user["id"]
    assert body["organization_id"] == org_user["organization_id"]
    assert "id" in body and "created_at" in body and "updated_at" in body

    # Owner row should be auto-created in project_members.
    async with session_maker() as session:
        rows = (
            await session.execute(
                text("SELECT role FROM project_members WHERE project_id = :pid AND user_id = :uid"),
                {"pid": body["id"], "uid": org_user["id"]},
            )
        ).all()
    assert len(rows) == 1
    assert rows[0][0] == "owner"


async def test_create_project_rejects_empty_name(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.post(
        "/projects", json={"name": ""}, headers=_auth(org_user["access_token"])
    )
    assert response.status_code == 422


async def test_create_project_rejects_overlong_name(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.post(
        "/projects", json={"name": "a" * 256}, headers=_auth(org_user["access_token"])
    )
    assert response.status_code == 422


async def test_create_project_duplicate_name_in_same_org_returns_409(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    first = await client.post(
        "/projects", json={"name": "Same"}, headers=_auth(org_user["access_token"])
    )
    assert first.status_code == 201
    second = await client.post(
        "/projects", json={"name": "Same"}, headers=_auth(org_user["access_token"])
    )
    assert second.status_code == 409


async def test_list_projects_returns_only_user_memberships(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    # Alice creates two projects.
    p1 = (
        await client.post("/projects", json={"name": "P1"}, headers=_auth(org_user["access_token"]))
    ).json()
    (
        await client.post("/projects", json={"name": "P2"}, headers=_auth(org_user["access_token"]))
    ).json()

    # Carol creates her own project — Alice is not a member.
    (
        await client.post(
            "/projects", json={"name": "Carols"}, headers=_auth(same_org_user["access_token"])
        )
    ).json()

    # Alice adds Carol to P1.
    add = await client.post(
        f"/projects/{p1['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert add.status_code == 201

    alice_list = await client.get("/projects", headers=_auth(org_user["access_token"]))
    assert alice_list.status_code == 200
    alice_names = sorted(p["name"] for p in alice_list.json())
    assert alice_names == ["P1", "P2"]

    carol_list = await client.get("/projects", headers=_auth(same_org_user["access_token"]))
    assert carol_list.status_code == 200
    carol_names = sorted(p["name"] for p in carol_list.json())
    assert carol_names == ["Carols", "P1"]


async def test_list_projects_excludes_other_org_projects(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    await client.post(
        "/projects", json={"name": "Alpha-1"}, headers=_auth(org_user["access_token"])
    )
    await client.post(
        "/projects", json={"name": "Beta-1"}, headers=_auth(other_org_user["access_token"])
    )

    alice = (await client.get("/projects", headers=_auth(org_user["access_token"]))).json()
    bob = (await client.get("/projects", headers=_auth(other_org_user["access_token"]))).json()
    assert [p["name"] for p in alice] == ["Alpha-1"]
    assert [p["name"] for p in bob] == ["Beta-1"]


async def test_get_project_404_for_non_member_same_org(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    p = (
        await client.post(
            "/projects", json={"name": "Hidden"}, headers=_auth(org_user["access_token"])
        )
    ).json()
    response = await client.get(
        f"/projects/{p['id']}", headers=_auth(same_org_user["access_token"])
    )
    assert response.status_code == 404


async def test_get_project_404_cross_org(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    p = (
        await client.post(
            "/projects", json={"name": "Alpha-only"}, headers=_auth(org_user["access_token"])
        )
    ).json()
    response = await client.get(
        f"/projects/{p['id']}", headers=_auth(other_org_user["access_token"])
    )
    assert response.status_code == 404


async def test_patch_project_owner_succeeds(client: AsyncClient, org_user: dict[str, str]) -> None:
    p = (
        await client.post(
            "/projects", json={"name": "Orig"}, headers=_auth(org_user["access_token"])
        )
    ).json()
    response = await client.patch(
        f"/projects/{p['id']}",
        json={"description": "updated"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 200
    assert response.json()["description"] == "updated"


async def test_patch_project_editor_succeeds(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    p = (
        await client.post(
            "/projects", json={"name": "Shared"}, headers=_auth(org_user["access_token"])
        )
    ).json()
    await client.post(
        f"/projects/{p['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.patch(
        f"/projects/{p['id']}",
        json={"description": "by editor"},
        headers=_auth(same_org_user["access_token"]),
    )
    assert response.status_code == 200
    assert response.json()["description"] == "by editor"


async def test_patch_project_viewer_forbidden(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    p = (
        await client.post(
            "/projects", json={"name": "Locked"}, headers=_auth(org_user["access_token"])
        )
    ).json()
    await client.post(
        f"/projects/{p['id']}/members",
        json={"user_id": same_org_user["id"], "role": "viewer"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.patch(
        f"/projects/{p['id']}",
        json={"description": "nope"},
        headers=_auth(same_org_user["access_token"]),
    )
    assert response.status_code == 403


async def test_patch_project_non_member_returns_404(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    p = (
        await client.post(
            "/projects", json={"name": "Solo"}, headers=_auth(org_user["access_token"])
        )
    ).json()
    response = await client.patch(
        f"/projects/{p['id']}",
        json={"description": "x"},
        headers=_auth(same_org_user["access_token"]),
    )
    assert response.status_code == 404


async def test_patch_project_empty_body_leaves_unchanged(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    p = (
        await client.post(
            "/projects",
            json={"name": "Stable", "description": "keep"},
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    response = await client.patch(
        f"/projects/{p['id']}", json={}, headers=_auth(org_user["access_token"])
    )
    assert response.status_code == 200
    assert response.json()["description"] == "keep"
    assert response.json()["name"] == "Stable"


async def test_archive_project_owner_makes_project_read_only(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    p = (
        await client.post(
            "/projects", json={"name": "Archive Me"}, headers=_auth(org_user["access_token"])
        )
    ).json()

    archive = await client.post(
        f"/projects/{p['id']}/archive",
        headers=_auth(org_user["access_token"]),
    )
    assert archive.status_code == 200
    assert archive.json()["lifecycle_state"] == "archived"
    assert archive.json()["status"] == "planning"

    patch = await client.patch(
        f"/projects/{p['id']}",
        json={"description": "blocked"},
        headers=_auth(org_user["access_token"]),
    )
    assert patch.status_code == 409
    assert patch.json()["detail"] == "PROJECT_ARCHIVED"


async def test_reactivate_project_owner_restores_active_state(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    p = (
        await client.post(
            "/projects", json={"name": "Reactivatable"}, headers=_auth(org_user["access_token"])
        )
    ).json()
    await client.post(f"/projects/{p['id']}/archive", headers=_auth(org_user["access_token"]))

    response = await client.post(
        f"/projects/{p['id']}/reactivate",
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 200
    assert response.json()["lifecycle_state"] == "active"


async def test_delete_project_owner_soft_removes_and_hides_from_reads(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    p = (
        await client.post(
            "/projects", json={"name": "ToRemove"}, headers=_auth(org_user["access_token"])
        )
    ).json()
    await client.post(
        f"/projects/{p['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )

    response = await client.delete(f"/projects/{p['id']}", headers=_auth(org_user["access_token"]))
    assert response.status_code == 204

    get_removed = await client.get(f"/projects/{p['id']}", headers=_auth(org_user["access_token"]))
    assert get_removed.status_code == 404

    listed = await client.get("/projects", headers=_auth(org_user["access_token"]))
    assert listed.status_code == 200
    assert [project["name"] for project in listed.json()] == []

    async with session_maker() as session:
        state = (
            await session.execute(
                text("SELECT lifecycle_state FROM projects WHERE id = :pid"),
                {"pid": p["id"]},
            )
        ).scalar_one()
        members = (
            await session.execute(
                text("SELECT count(*) FROM project_members WHERE project_id = :pid"),
                {"pid": p["id"]},
            )
        ).scalar_one()
    assert state == "removed"
    assert members == 2


async def test_delete_project_editor_forbidden(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    p = (
        await client.post(
            "/projects", json={"name": "Protected"}, headers=_auth(org_user["access_token"])
        )
    ).json()
    await client.post(
        f"/projects/{p['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.delete(
        f"/projects/{p['id']}", headers=_auth(same_org_user["access_token"])
    )
    assert response.status_code == 403


async def test_archive_project_editor_forbidden(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    p = (
        await client.post(
            "/projects", json={"name": "ArchiveProtected"}, headers=_auth(org_user["access_token"])
        )
    ).json()
    await client.post(
        f"/projects/{p['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )

    response = await client.post(
        f"/projects/{p['id']}/archive",
        headers=_auth(same_org_user["access_token"]),
    )
    assert response.status_code == 403


async def test_unauthenticated_project_request_returns_401(client: AsyncClient) -> None:
    response = await client.get("/projects")
    assert response.status_code == 401


async def test_user_without_org_forbidden(
    client: AsyncClient,
    email_transport: object,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    import re

    # Register without an organization_name so the user has organization_id NULL.
    await client.post(
        "/auth/register",
        json={
            "email": "loner@example.com",
            "password": "correct-horse-battery",
            "full_name": "Loner",
        },
    )
    sent = email_transport.last_for("loner@example.com")  # type: ignore[attr-defined]
    assert sent is not None
    match = re.search(r"Token:\s*(\S+)", sent.body)
    assert match is not None
    await client.post("/auth/verify", json={"token": match.group(1)})
    login = await client.post(
        "/auth/jwt/login",
        data={"username": "loner@example.com", "password": "correct-horse-battery"},
    )
    token = login.json()["access_token"]

    # Sanity: confirm DB really has NULL org for this user.
    async with session_maker() as session:
        org_id = (
            await session.execute(
                text("SELECT organization_id FROM users WHERE email = :e"),
                {"e": "loner@example.com"},
            )
        ).scalar_one()
    assert org_id is None

    response = await client.get("/projects", headers=_auth(token))
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Thumbnail upload (POST /projects/with-thumbnail)
# ---------------------------------------------------------------------------

# Minimal valid JPEG header bytes (1×1 white pixel)
_TINY_JPEG = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
    b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
    b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\x1e"
    b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f"
    b"\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01"
    b"\x00\x00?\x00\xfb\xd4\xb0\xff\xd9"
)


async def test_create_project_with_thumbnail_stores_and_returns_presigned_url(
    fake_storage_client: tuple[AsyncClient, object],
    org_user: dict[str, str],
) -> None:
    client, fake_storage = fake_storage_client  # type: ignore[misc]
    response = await client.post(
        "/projects/with-thumbnail",
        data={"name": "Thumb Project", "description": "with image"},
        files={"thumbnail": ("cover.jpg", _TINY_JPEG, "image/jpeg")},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "Thumb Project"
    assert body["description"] == "with image"
    # thumbnail_url should be the fake presigned GET URL (from FakeStorage)
    assert body["thumbnail_url"] is not None
    assert "http://fake-storage/" in body["thumbnail_url"]
    assert "thumbnails/" in body["thumbnail_url"]
    # The raw bytes should be stored in FakeStorage
    stored_keys = list(fake_storage.objects.keys())  # type: ignore[attr-defined]
    assert len(stored_keys) == 1
    assert stored_keys[0].startswith("thumbnails/")
    assert stored_keys[0].endswith(".jpg")


async def test_create_project_without_thumbnail_via_multipart_endpoint(
    fake_storage_client: tuple[AsyncClient, object],
    org_user: dict[str, str],
) -> None:
    client, fake_storage = fake_storage_client  # type: ignore[misc]
    response = await client.post(
        "/projects/with-thumbnail",
        data={"name": "No Thumb"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["thumbnail_url"] is None
    assert len(fake_storage.objects) == 0  # type: ignore[attr-defined]


async def test_create_project_thumbnail_too_large_returns_413(
    fake_storage_client: tuple[AsyncClient, object],
    org_user: dict[str, str],
) -> None:
    client, _ = fake_storage_client  # type: ignore[misc]
    over_limit = b"x" * (2 * 1024 * 1024 + 1)  # 2 MB + 1 byte
    response = await client.post(
        "/projects/with-thumbnail",
        data={"name": "BigThumb"},
        files={"thumbnail": ("big.jpg", over_limit, "image/jpeg")},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 413
    assert response.json()["detail"] == "THUMBNAIL_TOO_LARGE"


async def test_create_project_thumbnail_unsupported_mime_returns_415(
    fake_storage_client: tuple[AsyncClient, object],
    org_user: dict[str, str],
) -> None:
    client, _ = fake_storage_client  # type: ignore[misc]
    response = await client.post(
        "/projects/with-thumbnail",
        data={"name": "PdfThumb"},
        files={"thumbnail": ("doc.pdf", b"%PDF-1.4", "application/pdf")},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 415
    assert response.json()["detail"] == "THUMBNAIL_UNSUPPORTED_TYPE"
