"""Tests for free → paid conversion: POST /projects/{id}/import-pooled-model.

Covers the HEAD-version copy + Document/ProjectFile creation + tenant extraction
dispatch, the snag → finding mapping (v1), idempotency via the head file's
converted_to_file_id, and cross-user isolation (you can't import someone else's
free container).
"""

from datetime import date
from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.models.document import Document
from bimdossier_api.models.finding import Finding
from bimdossier_api.models.pooled_document import PooledDocument
from bimdossier_api.models.pooled_finding import PooledFinding
from bimdossier_api.models.pooled_project import PooledProject
from bimdossier_api.models.pooled_project_file import PooledProjectFile
from bimdossier_api.tenancy import schema_name_for
from tests.conftest import FakeStorage, _create_project
from tests.test_free_limits import _make_user


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed_free_container(
    session_maker: async_sessionmaker[AsyncSession],
    fake: FakeStorage,
    owner_id: str,
    *,
    with_snag: bool = True,
    snag_status: str = "open",
    assignee_id: str | None = None,
    deadline: str | None = None,
    discipline: str = "other",
    snag_creator_id: str | None = None,
) -> tuple[UUID, UUID, str]:
    """Insert a free project + container + ready/succeeded head file (+ optional
    snag) for `owner_id`, seeding the head source object in fake storage. Returns
    (document_id, file_id, storage_key)."""
    project_id = uuid4()
    document_id = uuid4()
    file_id = uuid4()
    storage_key = f"free/{owner_id}/{document_id}/{file_id}/source.ifc"
    async with session_maker() as s:
        # Flush in FK order (project → document → file) — the document↔file
        # use_alter cycle otherwise confuses the unit-of-work insert ordering.
        s.add(PooledProject(id=project_id, owner_user_id=UUID(owner_id), name="Free P"))
        await s.flush()
        s.add(
            PooledDocument(
                id=document_id,
                owner_user_id=UUID(owner_id),
                pooled_project_id=project_id,
                name="MyHouse",
                discipline=discipline,
                status="active",
                primary_file_type="ifc",
            )
        )
        await s.flush()
        s.add(
            PooledProjectFile(
                id=file_id,
                owner_user_id=UUID(owner_id),
                pooled_document_id=document_id,
                version_number=1,
                storage_key=storage_key,
                original_filename="MyHouse.ifc",
                size_bytes=1234,
                ifc_schema="IFC4",
                status="ready",
                extraction_status="succeeded",
            )
        )
        # Flush the file before the finding so its linked_file_id FK resolves: the
        # pooled_documents↔pooled_project_files use_alter cycle defeats the UOW insert
        # sort, which then falls back to alphabetical table order (pooled_findings
        # would otherwise insert before pooled_project_files).
        await s.flush()
        if with_snag:
            s.add(
                PooledFinding(
                    pooled_document_id=document_id,
                    linked_file_id=file_id,
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
                    assigned_to_user_id=UUID(assignee_id) if assignee_id else None,
                    deadline_date=date.fromisoformat(deadline) if deadline else None,
                    created_by_user_id=UUID(snag_creator_id) if snag_creator_id else None,
                )
            )
        await s.commit()
    fake.objects[storage_key] = b"ISO-10303-21;\n... ifc bytes ..."
    return document_id, file_id, storage_key


async def _tenant_counts(
    session_maker: async_sessionmaker[AsyncSession], org_id: str
) -> tuple[int, int]:
    schema = schema_name_for(UUID(org_id))
    async with session_maker() as s:
        await s.execute(text(f'SET search_path = "{schema}", public'))
        docs = await s.scalar(select(func.count()).select_from(Document))
        findings = await s.scalar(select(func.count()).select_from(Finding))
    return docs or 0, findings or 0


async def test_import_free_container_copies_and_maps_snags(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    job_dispatch_calls: list[dict],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="PaidProj")
    document_id, file_id, free_key = await _seed_free_container(
        session_maker, fake, org_user["id"]
    )

    resp = await client.post(
        f"/projects/{project['id']}/import-pooled-model",
        json={"pooled_document_id": str(document_id)},
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

    # The head free file is marked converted.
    async with session_maker() as s:
        free = await s.get(PooledProjectFile, file_id)
        assert free is not None
        assert free.converted_to_file_id == UUID(body["file_id"])


async def test_import_free_container_is_idempotent(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="PaidProj2")
    document_id, _file_id, _ = await _seed_free_container(
        session_maker, fake, org_user["id"], with_snag=False
    )

    first = await client.post(
        f"/projects/{project['id']}/import-pooled-model",
        json={"pooled_document_id": str(document_id)},
        headers=_auth(token),
    )
    assert first.status_code == 200, first.text

    second = await client.post(
        f"/projects/{project['id']}/import-pooled-model",
        json={"pooled_document_id": str(document_id)},
        headers=_auth(token),
    )
    assert second.status_code == 200, second.text
    assert second.json()["findings_created"] == 0
    assert second.json()["file_id"] == first.json()["file_id"]

    docs, _ = await _tenant_counts(session_maker, org_user["organization_id"])
    assert docs == 1


async def test_import_other_users_free_container_404(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A free container owned by a different user is invisible (RLS) → 404."""
    client, _ = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="PaidProj3")
    stranger_id = str(uuid4())
    async with session_maker() as s:
        await s.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_active, "
                "is_verified, is_superuser) VALUES (:id, :email, 'x', true, true, false)"
            ),
            {"id": stranger_id, "email": f"stranger-{stranger_id}@example.com"},
        )
        await s.commit()
    document_id, _file_id, _ = await _seed_free_container(
        session_maker, FakeStorage(), stranger_id, with_snag=False
    )

    resp = await client.post(
        f"/projects/{project['id']}/import-pooled-model",
        json={"pooled_document_id": str(document_id)},
        headers=_auth(token),
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "FREE_DOCUMENT_NOT_FOUND"


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
    document_id, _file_id, _ = await _seed_free_container(
        session_maker, fake, org_user["id"], snag_status="in_progress"
    )

    resp = await client.post(
        f"/projects/{project['id']}/import-pooled-model",
        json={"pooled_document_id": str(document_id)},
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


async def test_import_carries_assignee_and_deadline(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Conversion carries the free snag's assignee + deadline onto the tenant
    finding. The assignee id references public.users (global), so it's carried
    as-is even if that user is not (yet) a member of the destination paid org."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="AssignConvProj")
    # Assign to the importer (a real, existing user) + a deadline.
    document_id, _file_id, _ = await _seed_free_container(
        session_maker,
        fake,
        org_user["id"],
        assignee_id=org_user["id"],
        deadline="2026-10-01",
    )

    resp = await client.post(
        f"/projects/{project['id']}/import-pooled-model",
        json={"pooled_document_id": str(document_id)},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["findings_created"] == 1

    schema = schema_name_for(UUID(org_user["organization_id"]))
    async with session_maker() as s:
        await s.execute(text(f'SET search_path = "{schema}", public'))
        row = (
            await s.execute(select(Finding.assignee_user_id, Finding.deadline_date))
        ).one()
    assert str(row[0]) == org_user["id"]
    assert row[1] == date(2026, 10, 1)


async def test_import_carries_discipline_and_original_author(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
    job_dispatch_calls: list[dict],
) -> None:
    """POOL-CONV-DISCIPLINE-1 + author preservation: conversion carries the free
    container's real discipline (not hard-coded architectural) onto the new
    Document AND the extraction job payload, and preserves the snag's original
    author rather than stamping the importer."""
    client, fake = fake_storage_client
    token = org_user["access_token"]
    project = await _create_project(client, token, name="DiscProj")
    # A distinct snag author (the importer is org_user); preservation must keep it.
    async with session_maker() as s:
        author = await _make_user(s, "snag-author@example.com")
    document_id, _file_id, _ = await _seed_free_container(
        session_maker,
        fake,
        org_user["id"],
        discipline="structural",
        snag_creator_id=str(author.id),
    )

    resp = await client.post(
        f"/projects/{project['id']}/import-pooled-model",
        json={"pooled_document_id": str(document_id)},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text

    # Job payload carries the real discipline, not architectural.
    assert job_dispatch_calls[0]["payload"]["discipline"] == "structural"

    schema = schema_name_for(UUID(org_user["organization_id"]))
    async with session_maker() as s:
        await s.execute(text(f'SET search_path = "{schema}", public'))
        doc_discipline = await s.scalar(select(Document.discipline))
        finding_author = await s.scalar(select(Finding.created_by_user_id))
    assert doc_discipline is not None and doc_discipline.value == "structural"
    assert str(finding_author) == str(author.id)
