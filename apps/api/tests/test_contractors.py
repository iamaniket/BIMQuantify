"""Tests for the /contractors CRUD endpoints and tenant isolation."""

from httpx import AsyncClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Create + read
# ---------------------------------------------------------------------------


async def test_create_contractor_minimal(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.post(
        "/contractors",
        json={"name": "Bouw BV"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "Bouw BV"
    assert body["organization_id"] == org_user["organization_id"]
    assert body["kvk_number"] is None
    assert body["contact_email"] is None
    assert body["contact_phone"] is None
    assert "id" in body and "created_at" in body and "updated_at" in body


async def test_create_contractor_full_fields(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.post(
        "/contractors",
        json={
            "name": "Aannemer Jansen",
            "kvk_number": "12345678",
            "contact_email": "info@jansen.nl",
            "contact_phone": "+31 20 123 4567",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["kvk_number"] == "12345678"
    assert body["contact_email"] == "info@jansen.nl"
    assert body["contact_phone"] == "+31 20 123 4567"


async def test_create_contractor_rejects_empty_name(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.post(
        "/contractors",
        json={"name": ""},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 422


async def test_contractor_name_unique_per_org(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    first = await client.post(
        "/contractors",
        json={"name": "Bouw BV"},
        headers=_auth(org_user["access_token"]),
    )
    assert first.status_code == 201
    second = await client.post(
        "/contractors",
        json={"name": "Bouw BV"},
        headers=_auth(org_user["access_token"]),
    )
    assert second.status_code == 409


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


async def test_list_contractors_org_scoped(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    await client.post(
        "/contractors", json={"name": "Alpha-Bouw"}, headers=_auth(org_user["access_token"])
    )
    await client.post(
        "/contractors", json={"name": "Beta-Bouw"}, headers=_auth(other_org_user["access_token"])
    )

    alice_list = await client.get("/contractors", headers=_auth(org_user["access_token"]))
    assert alice_list.status_code == 200
    alice_names = sorted(c["name"] for c in alice_list.json())
    assert alice_names == ["Alpha-Bouw"]

    bob_list = await client.get("/contractors", headers=_auth(other_org_user["access_token"]))
    assert bob_list.status_code == 200
    bob_names = sorted(c["name"] for c in bob_list.json())
    assert bob_names == ["Beta-Bouw"]


async def test_same_name_allowed_across_orgs(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    first = await client.post(
        "/contractors", json={"name": "Bouw BV"}, headers=_auth(org_user["access_token"])
    )
    second = await client.post(
        "/contractors", json={"name": "Bouw BV"}, headers=_auth(other_org_user["access_token"])
    )
    assert first.status_code == 201
    assert second.status_code == 201


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


async def test_update_contractor(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    created = (
        await client.post(
            "/contractors",
            json={"name": "Old Name"},
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    response = await client.patch(
        f"/contractors/{created['id']}",
        json={"name": "New Name", "kvk_number": "87654321"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "New Name"
    assert body["kvk_number"] == "87654321"


# ---------------------------------------------------------------------------
# Delete: should NULL out the contractor_id on referencing projects (SET NULL).
# ---------------------------------------------------------------------------


async def test_delete_contractor_nullifies_project_fk(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    contractor = (
        await client.post(
            "/contractors",
            json={"name": "Bouw BV"},
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    project = (
        await client.post(
            "/projects",
            json={"name": "Linked", "contractor_id": contractor["id"]},
            headers=_auth(org_user["access_token"]),
        )
    ).json()
    assert project["contractor_id"] == contractor["id"]

    delete = await client.delete(
        f"/contractors/{contractor['id']}", headers=_auth(org_user["access_token"])
    )
    assert delete.status_code == 204

    # Project should still exist; contractor_id should now be None.
    fetched = await client.get(
        f"/projects/{project['id']}", headers=_auth(org_user["access_token"])
    )
    assert fetched.status_code == 200
    assert fetched.json()["contractor_id"] is None
    assert fetched.json()["contractor_name"] is None


# ---------------------------------------------------------------------------
# Cross-org isolation on individual GET
# ---------------------------------------------------------------------------


async def test_get_contractor_cross_org_isolated(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    contractor = (
        await client.post(
            "/contractors",
            json={"name": "Alpha-Only"},
            headers=_auth(org_user["access_token"]),
        )
    ).json()

    response = await client.get(
        f"/contractors/{contractor['id']}",
        headers=_auth(other_org_user["access_token"]),
    )
    assert response.status_code == 404
