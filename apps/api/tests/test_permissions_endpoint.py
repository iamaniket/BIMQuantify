"""Integration tests for the permission-matrix endpoint and the `my_role`
field stamped onto project read responses.

These back the portal's UI gating: the portal mirrors `GET /permissions/matrix`
and reads `my_role` off each project to decide which controls to show.
"""

from httpx import AsyncClient

from bimstitch_api.auth.permissions import serialize_matrix
from bimstitch_api.models.project_member import ProjectRole


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


# ---------------------------------------------------------------------------
# GET /permissions/matrix
# ---------------------------------------------------------------------------


async def test_permission_matrix_endpoint_returns_full_matrix(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.get(
        "/permissions/matrix", headers=_auth(org_user["access_token"])
    )
    assert response.status_code == 200, response.text
    body = response.json()
    # Wire payload is exactly the serialized matrix — the portal mirrors this.
    assert body == serialize_matrix()
    assert set(body.keys()) == {role.value for role in ProjectRole}


async def test_permission_matrix_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/permissions/matrix")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# my_role on project reads
# ---------------------------------------------------------------------------


async def test_create_project_returns_owner_my_role(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user)
    assert project["my_role"] == "owner"


async def test_get_project_returns_owner_my_role_for_creator(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    # org_user is an org admin AND the project owner. `my_role` must reflect the
    # real owner membership, not be blanked by the admin read-bypass.
    project = await _create_project(client, org_user)
    response = await client.get(
        f"/projects/{project['id']}", headers=_auth(org_user["access_token"])
    )
    assert response.status_code == 200, response.text
    assert response.json()["my_role"] == "owner"


async def test_get_project_returns_member_role(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    add = await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "viewer"},
        headers=_auth(org_user["access_token"]),
    )
    assert add.status_code == 201, add.text
    response = await client.get(
        f"/projects/{project['id']}",
        headers=_auth(same_org_non_admin_user["access_token"]),
    )
    assert response.status_code == 200, response.text
    assert response.json()["my_role"] == "viewer"


async def test_list_projects_includes_member_role(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    project = await _create_project(client, org_user)
    await client.post(
        f"/projects/{project['id']}/members",
        json={"user_id": same_org_non_admin_user["id"], "role": "inspector"},
        headers=_auth(org_user["access_token"]),
    )
    response = await client.get(
        "/projects", headers=_auth(same_org_non_admin_user["access_token"])
    )
    assert response.status_code == 200, response.text
    items = response.json()
    assert len(items) == 1
    assert items[0]["id"] == project["id"]
    assert items[0]["my_role"] == "inspector"


async def test_list_projects_includes_owner_role(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    project = await _create_project(client, org_user)
    response = await client.get("/projects", headers=_auth(org_user["access_token"]))
    assert response.status_code == 200, response.text
    ours = [p for p in response.json() if p["id"] == project["id"]]
    assert ours, "creator should see their own project"
    assert ours[0]["my_role"] == "owner"
