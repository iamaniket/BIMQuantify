"""Tests for the enriched Project fields: status, phase, address, delivery date,
reference code, permit number, and contractor link.
"""

from httpx import AsyncClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------


async def test_create_project_defaults_status_and_phase(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.post(
        "/projects",
        json={"name": "Site A"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "planning"
    assert body["phase"] == "ontwerp"
    # Optional fields default to None.
    for field in (
        "reference_code",
        "delivery_date",
        "street",
        "house_number",
        "postal_code",
        "city",
        "municipality",
        "bag_id",
        "permit_number",
        "contractor_id",
        "contractor_name",
    ):
        assert body[field] is None, f"{field} should default to None"


# ---------------------------------------------------------------------------
# Create with all fields
# ---------------------------------------------------------------------------


async def test_create_project_with_all_new_fields(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    payload = {
        "name": "Roof Plan",
        "description": "Townhouses",
        "reference_code": "WKB-2026-0411",
        "status": "uitvoering",
        "phase": "ruwbouw",
        "delivery_date": "2026-08-12",
        "street": "Hoofdstraat",
        "house_number": "12A",
        "postal_code": "1234 AB",
        "city": "Amsterdam",
        "municipality": "Amsterdam",
        "bag_id": "0363200012345678",
        "permit_number": "OV-2026-0099",
    }
    response = await client.post(
        "/projects", json=payload, headers=_auth(org_user["access_token"])
    )
    assert response.status_code == 201, response.text
    body = response.json()
    for k, v in payload.items():
        assert body[k] == v, f"{k} mismatch: got {body[k]!r}, expected {v!r}"


# ---------------------------------------------------------------------------
# Patch (status, phase, address)
# ---------------------------------------------------------------------------


async def test_patch_project_status(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    created = (
        await client.post(
            "/projects", json={"name": "P1"}, headers=_auth(org_user["access_token"])
        )
    ).json()

    response = await client.patch(
        f"/projects/{created['id']}",
        json={"status": "uitvoering"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "uitvoering"


async def test_patch_project_address_fields(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    created = (
        await client.post(
            "/projects", json={"name": "P2"}, headers=_auth(org_user["access_token"])
        )
    ).json()

    response = await client.patch(
        f"/projects/{created['id']}",
        json={
            "street": "Damrak",
            "house_number": "70",
            "postal_code": "1012 LM",
            "city": "Amsterdam",
        },
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["street"] == "Damrak"
    assert body["house_number"] == "70"
    assert body["postal_code"] == "1012 LM"
    assert body["city"] == "Amsterdam"


# ---------------------------------------------------------------------------
# Reference code uniqueness (partial unique: NULL allowed multiple times,
# non-null must be unique per organization, but allowed to repeat across orgs)
# ---------------------------------------------------------------------------


async def test_reference_code_unique_per_org(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    first = await client.post(
        "/projects",
        json={"name": "First", "reference_code": "WKB-2026-0411"},
        headers=_auth(org_user["access_token"]),
    )
    assert first.status_code == 201, first.text
    second = await client.post(
        "/projects",
        json={"name": "Second", "reference_code": "WKB-2026-0411"},
        headers=_auth(org_user["access_token"]),
    )
    assert second.status_code == 409


async def test_reference_code_allows_multiple_nulls(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    first = await client.post(
        "/projects", json={"name": "A"}, headers=_auth(org_user["access_token"])
    )
    second = await client.post(
        "/projects", json={"name": "B"}, headers=_auth(org_user["access_token"])
    )
    assert first.status_code == 201
    assert second.status_code == 201


async def test_reference_code_unique_cross_org(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    first = await client.post(
        "/projects",
        json={"name": "Alpha", "reference_code": "WKB-2026-0411"},
        headers=_auth(org_user["access_token"]),
    )
    second = await client.post(
        "/projects",
        json={"name": "Beta", "reference_code": "WKB-2026-0411"},
        headers=_auth(other_org_user["access_token"]),
    )
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text


# ---------------------------------------------------------------------------
# Validation: status/phase enum values
# ---------------------------------------------------------------------------


async def test_create_project_rejects_invalid_status(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.post(
        "/projects",
        json={"name": "X", "status": "not_a_real_status"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 422


async def test_create_project_rejects_invalid_phase(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.post(
        "/projects",
        json={"name": "X", "phase": "not_a_real_phase"},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Contractor link: contractor_name in project response
# ---------------------------------------------------------------------------


async def test_contractor_name_in_project_read(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    contractor = await client.post(
        "/contractors",
        json={"name": "Bouw BV"},
        headers=_auth(org_user["access_token"]),
    )
    assert contractor.status_code == 201, contractor.text
    contractor_id = contractor.json()["id"]

    created = await client.post(
        "/projects",
        json={"name": "With Contractor", "contractor_id": contractor_id},
        headers=_auth(org_user["access_token"]),
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["contractor_id"] == contractor_id
    assert body["contractor_name"] == "Bouw BV"

    # And on GET as well.
    fetched = await client.get(
        f"/projects/{body['id']}", headers=_auth(org_user["access_token"])
    )
    assert fetched.status_code == 200
    assert fetched.json()["contractor_name"] == "Bouw BV"


async def test_create_project_with_coordinates(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.post(
        "/projects",
        json={
            "name": "Geo Project",
            "latitude": 52.373010,
            "longitude": 4.892929,
        },
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["latitude"] == 52.373010
    assert body["longitude"] == 4.892929


async def test_patch_project_coordinates(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    created = (
        await client.post(
            "/projects", json={"name": "P-coord"}, headers=_auth(org_user["access_token"])
        )
    ).json()

    response = await client.patch(
        f"/projects/{created['id']}",
        json={"latitude": 51.9244, "longitude": 4.4777},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["latitude"] == 51.9244
    assert body["longitude"] == 4.4777


async def test_create_project_rejects_invalid_latitude(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.post(
        "/projects",
        json={"name": "Bad lat", "latitude": 200, "longitude": 0},
        headers=_auth(org_user["access_token"]),
    )
    assert response.status_code == 422


async def test_unknown_contractor_id_rejected(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    response = await client.post(
        "/projects",
        json={
            "name": "Bad Contractor",
            "contractor_id": "00000000-0000-0000-0000-000000000000",
        },
        headers=_auth(org_user["access_token"]),
    )
    # Either 400 (validation in router) or 422 (FK rejected). 409 if treated as conflict.
    assert response.status_code in (400, 404, 409, 422), response.text
