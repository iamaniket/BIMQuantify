"""Tests for free → paid conversion: POST /projects/{id}/import-free-model.

Covers the model copy + Document/ProjectFile creation + tenant extraction
dispatch, the snag → finding mapping (v1), idempotency via converted_to_file_id,
and cross-user isolation (you can't import someone else's free model).
"""

from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.models.document import Document
from bimdossier_api.models.finding import Finding
from bimdossier_api.models.free_model import FreeModel
from bimdossier_api.models.free_snag import FreeSnag
from bimdossier_api.tenancy import schema_name_for
from tests.conftest import FakeStorage, _create_project


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed_free_model(
    session_maker: async_sessionmaker[AsyncSession],
    fake: FakeStorage,
    owner_id: str,
    *,
    with_snag: bool = True,
    snag_status: str = "open",
) -> tuple[UUID, str]:
    """Insert a ready+succeeded free model (+ optional snag) for `owner_id` and
    seed its source object in fake storage. Returns (model_id, storage_key)."""
    model_id = uuid4()
    storage_key = f"free/{owner_id}/{model_id}/source.ifc"
    async with session_maker() as s:
        s.add(
            FreeModel(
                id=model_id,
                owner_user_id=UUID(owner_id),
                name="MyHouse.ifc",
                original_filename="MyHouse.ifc",
                storage_key=storage_key,
                size_bytes=1234,
                ifc_schema="IFC4",
                status="ready",
                extraction_status="succeeded",
            )
        )
        if with_snag:
            s.add(
                FreeSnag(
                    free_model_id=model_id,
                    owner_user_id=UUID(owner_id),
                    title="Cracked beam",
                    note="grid C3",
                    severity="high",
                    status=snag_status,
                    linked_file_type="ifc",
                    anchor_x=1.5,
                    anchor_y=2.5,
                    anchor_z=3.5,
                    linked_element_global_id="2O2Fr$t4X7Zf8NOew3FNld",
                )
            )
        await s.commit()
    fake.objects[storage_key] = b"ISO-10303-21;\n... ifc bytes ..."
    return model_id, storage_key


async def _tenant_counts(
    session_maker: async_sessionmaker[AsyncSession], org_id: str
) -> tuple[int, int]:
    schema = schema_name_for(UUID(org_id))
    async with session_maker() as s:
        await s.execute(text(f'SET search_path = "{schema}", public'))
        docs = await s.scalar(select(func.count()).select_from(Document))
        findings = await s.scalar(select(func.count()).select_from(Finding))
    return docs or 0, findings or 0


async def test_import_free_model_copies_and_maps_snags(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    job_dispatch_calls: list[dict],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="PaidProj")
    model_id, free_key = await _seed_free_model(
        session_maker, fake, org_user["id"]
    )

    resp = await client.post(
        f"/projects/{project['id']}/import-free-model",
        json={"free_model_id": str(model_id)},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["findings_created"] == 1

    # The raw IFC was copied into the project namespace.
    new_key = next(k for k in fake.objects if k.startswith(f"projects/{project['id']}/"))
    assert fake.objects[new_key] == fake.objects[free_key]

    # Tenant extraction was dispatched at the PAYING priority.
    assert len(job_dispatch_calls) == 1
    call = job_dispatch_calls[0]
    assert call["job_type"] == "ifc_extraction"
    assert call["priority"] == 10  # job_priority_paying
    assert call["payload"]["storage_key"] == new_key

    # A Document + a mapped Finding now exist in the tenant schema.
    docs, findings = await _tenant_counts(session_maker, org_user["organization_id"])
    assert docs == 1
    assert findings == 1

    # The free row is marked converted.
    async with session_maker() as s:
        free = await s.get(FreeModel, model_id)
        assert free is not None
        assert free.converted_to_file_id == UUID(body["file_id"])


async def test_import_free_model_is_idempotent(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="PaidProj2")
    model_id, _ = await _seed_free_model(
        session_maker, fake, org_user["id"], with_snag=False
    )

    first = await client.post(
        f"/projects/{project['id']}/import-free-model",
        json={"free_model_id": str(model_id)},
        headers=_auth(token),
    )
    assert first.status_code == 200, first.text

    second = await client.post(
        f"/projects/{project['id']}/import-free-model",
        json={"free_model_id": str(model_id)},
        headers=_auth(token),
    )
    assert second.status_code == 200, second.text
    assert second.json()["findings_created"] == 0
    assert second.json()["file_id"] == first.json()["file_id"]

    # Still exactly one document — the re-import created nothing.
    docs, _ = await _tenant_counts(session_maker, org_user["organization_id"])
    assert docs == 1


async def test_import_other_users_free_model_404(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A free model owned by a different user is invisible (RLS) → 404."""
    client, _ = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="PaidProj3")
    # Free model owned by a stranger, not org_user.
    stranger_id = str(uuid4())
    model_id = uuid4()
    async with session_maker() as s:
        # The owner FK requires a real user row; insert a bare one.
        await s.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_active, "
                "is_verified, is_superuser) VALUES (:id, :email, 'x', true, true, false)"
            ),
            {"id": stranger_id, "email": f"stranger-{stranger_id}@example.com"},
        )
        s.add(
            FreeModel(
                id=model_id,
                owner_user_id=UUID(stranger_id),
                name="Theirs.ifc",
                original_filename="Theirs.ifc",
                storage_key=f"free/{stranger_id}/{model_id}/source.ifc",
                size_bytes=10,
                status="ready",
                extraction_status="succeeded",
            )
        )
        await s.commit()

    resp = await client.post(
        f"/projects/{project['id']}/import-free-model",
        json={"free_model_id": str(model_id)},
        headers=_auth(token),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "FREE_MODEL_NOT_FOUND"


async def test_import_maps_snag_status_one_to_one(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Free snag status is value-identical to FindingStatus, so a snag in any of
    the five states converts to a finding in the SAME state (no remap)."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="StatusProj")
    model_id, _ = await _seed_free_model(
        session_maker, fake, org_user["id"], snag_status="in_progress"
    )

    resp = await client.post(
        f"/projects/{project['id']}/import-free-model",
        json={"free_model_id": str(model_id)},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["findings_created"] == 1

    schema = schema_name_for(UUID(org_user["organization_id"]))
    async with session_maker() as s:
        await s.execute(text(f'SET search_path = "{schema}", public'))
        status_value = await s.scalar(select(Finding.status))
    assert status_value is not None
    assert status_value.value == "in_progress"
