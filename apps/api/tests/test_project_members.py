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
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    response = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["user_id"] == same_org_user["id"]
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


async def test_editor_cannot_add_member(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    # Give same_org_user editor role first.
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    # Editor tries to invite themselves again (role change disguise) — denied.
    response = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_user["id"], "role": "viewer"},
        headers=_auth(same_org_user["access_token"]),
    )
    assert response.status_code == 403


async def test_duplicate_member_add_returns_409(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_user["id"], "role": "viewer"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 409


async def test_cannot_add_second_owner(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    response = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_user["id"], "role": "owner"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 400


async def test_remove_non_owner_member(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.delete(
        f"/projects/{project['id']}/members/{same_org_user['id']}",
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
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    response = await client.delete(
        f"/projects/{project['id']}/members/{same_org_user['id']}",
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 404


async def test_change_role_viewer_to_editor(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_user["id"], "role": "viewer"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.patch(
        f"/projects/{project['id']}/members/{same_org_user['id']}",
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
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.patch(
        f"/projects/{project['id']}/members/{same_org_user['id']}",
        json={"role": "owner"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 400


async def test_editor_forbidden_on_member_routes(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_user["id"], "role": "editor"},
        headers=_auth(org_user["access_token"]),
    )
    # Editor tries to remove the owner (should be 403 — non-owner can't manage members at all).
    response = await client.delete(
        f"/projects/{project['id']}/members/{org_user['id']}",
        headers=_auth(same_org_user["access_token"]),
    )
    assert response.status_code == 403
