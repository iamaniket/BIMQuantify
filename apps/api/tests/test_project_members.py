from httpx import AsyncClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_project(
    client: AsyncClient, owner: dict[str, str], name: str = "P"
) -> dict[str, str]:
    response = await client.post(
        "/projects", json={"name": name}, headers=_auth(owner["access_token"])
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_owner_can_add_same_org_user_as_editor(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    response = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["user_id"] == same_org_non_admin_user["id"]
    assert body["role"] == "editor"


async def test_owner_cannot_add_cross_org_user(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    response = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": other_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 400


async def test_non_admin_editor_cannot_add_member(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    # Give the non-admin user editor role first.
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    # Editor (who is not an org admin) tries to add a member — denied.
    response = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "viewer"},
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert response.status_code == 403


async def test_duplicate_member_add_returns_409(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "viewer"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 409


async def test_cannot_add_second_owner(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    response = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "owner"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 400


async def test_remove_non_owner_member(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.delete(
        f"/projects/{project['id']}/members/{same_org_non_admin_user['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 204


async def test_cannot_remove_owner(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user)
    response = await client.delete(
        f"/projects/{project['id']}/members/{org_user['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 400


async def test_remove_non_member_returns_404(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    response = await client.delete(
        f"/projects/{project['id']}/members/{same_org_non_admin_user['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 404


async def test_change_role_viewer_to_editor(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "viewer"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.patch(
        f"/projects/{project['id']}/members/{same_org_non_admin_user['id']}",
        json={"role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 200
    assert response.json()["role"] == "editor"


async def test_cannot_change_owner_role(client: AsyncClient, org_user: dict[str, str]) -> None:
    project = await _create_project(client, org_user)
    response = await client.patch(
        f"/projects/{project['id']}/members/{org_user['id']}",
        json={"role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 400


async def test_cannot_promote_to_owner(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.patch(
        f"/projects/{project['id']}/members/{same_org_non_admin_user['id']}",
        json={"role": "owner"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 400


async def test_non_admin_editor_forbidden_on_member_routes(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    # A non-admin editor tries to remove the owner — 403. Non-owners who aren't
    # also org admins can't manage members at all.
    response = await client.delete(
        f"/projects/{project['id']}/members/{org_user['id']}",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert response.status_code == 403


async def test_org_admin_can_add_member_to_project_they_dont_own(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_admin_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    """An org admin who isn't on the project can still assign access to it."""
    project = await _create_project(client, org_user)
    response = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "viewer"},
        headers=_auth(same_org_admin_user["access_token"]),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["user_id"] == same_org_non_admin_user["id"]
    assert body["role"] == "viewer"
    # Enriched fields are populated.
    assert body["email"] == "dave@example.com"
    assert body["full_name"] == "dave"


async def test_org_admin_can_remove_member_from_project_they_dont_own(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_admin_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.delete(
        f"/projects/{project['id']}/members/{same_org_non_admin_user['id']}",
        headers=_auth(same_org_admin_user["access_token"]),
    )
    assert response.status_code == 204


async def test_org_admin_can_change_member_role_on_project_they_dont_own(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_admin_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "viewer"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.patch(
        f"/projects/{project['id']}/members/{same_org_non_admin_user['id']}",
        json={"role": "editor"},
        headers=_auth(same_org_admin_user["access_token"]),
    )
    assert response.status_code == 200, response.text
    assert response.json()["role"] == "editor"


async def test_list_members_returns_email_and_full_name(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.get(
        f"/projects/{project['id']}/members",
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 200, response.text
    members = response.json()
    assert len(members) == 2
    by_email = {m["email"]: m for m in members}
    assert "alice@example.com" in by_email
    assert by_email["alice@example.com"]["role"] == "owner"
    assert by_email["alice@example.com"]["full_name"] == "alice"
    assert "dave@example.com" in by_email
    assert by_email["dave@example.com"]["role"] == "editor"


async def test_list_members_visible_to_org_admin_not_on_project(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    response = await client.get(
        f"/projects/{project['id']}/members",
        headers=_auth(same_org_admin_user["access_token"]),
    )
    assert response.status_code == 200, response.text
    assert any(m["role"] == "owner" for m in response.json())


async def test_list_members_404_for_non_member_non_admin(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    response = await client.get(
        f"/projects/{project['id']}/members",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert response.status_code == 404


async def test_list_members_404_for_cross_org_user(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    response = await client.get(
        f"/projects/{project['id']}/members",
        headers=_auth(other_org_user["access_token"]),
    )
    # Cross-tenant: schema isolation means project doesn't resolve at all → 404.
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Archived project rejects member mutations
# ---------------------------------------------------------------------------


async def test_add_member_to_archived_project_returns_409(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/archive",
        headers=_auth(org_user["access_token"]),
    )
    response = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "PROJECT_ARCHIVED"


async def test_remove_member_from_archived_project_returns_409(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/archive",
        headers=_auth(org_user["access_token"]),
    )
    response = await client.delete(
        f"/projects/{project['id']}/members/{same_org_non_admin_user['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "PROJECT_ARCHIVED"


async def test_update_role_on_archived_project_returns_409(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "viewer"},
        headers=_auth(org_user["access_token"]),
    )
    await client.post(
        f"/projects/{project['id']}/archive",
        headers=_auth(org_user["access_token"]),
    )
    response = await client.patch(
        f"/projects/{project['id']}/members/{same_org_non_admin_user['id']}",
        json={"role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "PROJECT_ARCHIVED"


async def test_list_members_pagination_and_total_count(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    # The owner is auto-added as a member; adding one more gives a list of 2.
    resp = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "viewer"},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 201, resp.text

    full = await client.get(
        f"/projects/{project['id']}/members",
        headers=_auth(org_user["access_token"]),
    )
    assert full.status_code == 200, full.text
    total = len(full.json())
    assert total == 2
    assert full.headers["X-Total-Count"] == str(total)

    capped = await client.get(
        f"/projects/{project['id']}/members?limit=1",
        headers=_auth(org_user["access_token"]),
    )
    assert capped.status_code == 200, capped.text
    assert len(capped.json()) == 1
    assert capped.headers["X-Total-Count"] == str(total)

    too_big = await client.get(
        f"/projects/{project['id']}/members?limit=201",
        headers=_auth(org_user["access_token"]),
    )
    assert too_big.status_code == 422
