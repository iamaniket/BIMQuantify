"""DB-level RLS isolation for the models table.

Mirrors test_projects_rls.py — bypasses HTTP and proves that PostgreSQL itself
filters models by the current org GUC. Also proves that the rewritten
project_files policy (which now scopes through models → projects) blocks
cross-org reads.
"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


async def _set_org_guc(session: AsyncSession, org_id: UUID) -> None:
    await session.execute(
        text("SELECT set_config('app.current_org_id', :v, true)"),
        {"v": str(org_id)},
    )


async def _enter_tenant(session: AsyncSession, org_id: UUID) -> None:
    await session.execute(text("SET LOCAL ROLE bim_app"))
    await _set_org_guc(session, org_id)


@pytest.fixture
async def two_orgs_with_models(
    session_maker: async_sessionmaker[AsyncSession],
) -> dict[str, UUID]:
    """Seed two orgs, each with a user + project + model + file. Seeded as the
    superuser so RLS doesn't apply (we never SET ROLE bim_app here)."""
    async with session_maker() as session, session.begin():
        a_org = uuid4()
        await session.execute(
            text("INSERT INTO organizations (id, name) VALUES (:id, 'M-RLS-A')"),
            {"id": str(a_org)},
        )
        a_user = uuid4()
        await session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_active, "
                "is_superuser, is_verified, organization_id) "
                "VALUES (:id, 'a@models.test', 'x', true, false, true, :org)"
            ),
            {"id": str(a_user), "org": str(a_org)},
        )
        a_project = uuid4()
        await session.execute(
            text(
                "INSERT INTO projects (id, organization_id, name, owner_id) "
                "VALUES (:id, :org, 'A-proj', :owner)"
            ),
            {"id": str(a_project), "org": str(a_org), "owner": str(a_user)},
        )
        a_model = uuid4()
        await session.execute(
            text(
                "INSERT INTO models (id, project_id, name, discipline, status) "
                "VALUES (:id, :pid, 'A-model', 'architectural', 'active')"
            ),
            {"id": str(a_model), "pid": str(a_project)},
        )
        a_file = uuid4()
        await session.execute(
            text(
                "INSERT INTO project_files "
                "(id, model_id, version_number, uploaded_by_user_id, storage_key, "
                "original_filename, size_bytes, content_type, status) "
                "VALUES (:id, :mid, 1, :uid, :sk, 'a.ifc', 100, "
                "'application/octet-stream', 'ready')"
            ),
            {
                "id": str(a_file),
                "mid": str(a_model),
                "uid": str(a_user),
                "sk": f"projects/{a_project}/models/{a_model}/{a_file}.ifc",
            },
        )

        b_org = uuid4()
        await session.execute(
            text("INSERT INTO organizations (id, name) VALUES (:id, 'M-RLS-B')"),
            {"id": str(b_org)},
        )
        b_user = uuid4()
        await session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_active, "
                "is_superuser, is_verified, organization_id) "
                "VALUES (:id, 'b@models.test', 'x', true, false, true, :org)"
            ),
            {"id": str(b_user), "org": str(b_org)},
        )
        b_project = uuid4()
        await session.execute(
            text(
                "INSERT INTO projects (id, organization_id, name, owner_id) "
                "VALUES (:id, :org, 'B-proj', :owner)"
            ),
            {"id": str(b_project), "org": str(b_org), "owner": str(b_user)},
        )
        b_model = uuid4()
        await session.execute(
            text(
                "INSERT INTO models (id, project_id, name, discipline, status) "
                "VALUES (:id, :pid, 'B-model', 'structural', 'active')"
            ),
            {"id": str(b_model), "pid": str(b_project)},
        )
        b_file = uuid4()
        await session.execute(
            text(
                "INSERT INTO project_files "
                "(id, model_id, version_number, uploaded_by_user_id, storage_key, "
                "original_filename, size_bytes, content_type, status) "
                "VALUES (:id, :mid, 1, :uid, :sk, 'b.ifc', 200, "
                "'application/octet-stream', 'ready')"
            ),
            {
                "id": str(b_file),
                "mid": str(b_model),
                "uid": str(b_user),
                "sk": f"projects/{b_project}/models/{b_model}/{b_file}.ifc",
            },
        )

    return {
        "a_org": a_org,
        "a_project": a_project,
        "a_model": a_model,
        "a_file": a_file,
        "a_user": a_user,
        "b_org": b_org,
        "b_project": b_project,
        "b_model": b_model,
        "b_file": b_file,
        "b_user": b_user,
    }


async def test_models_visible_only_for_matching_org(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_with_models: dict[str, UUID],
) -> None:
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_with_models["a_org"])
        rows = (await session.execute(text("SELECT name FROM models"))).all()
    assert sorted(r[0] for r in rows) == ["A-model"]

    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_with_models["b_org"])
        rows = (await session.execute(text("SELECT name FROM models"))).all()
    assert sorted(r[0] for r in rows) == ["B-model"]


async def test_models_invisible_when_guc_unset(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_with_models: dict[str, UUID],
) -> None:
    async with session_maker() as session, session.begin():
        await session.execute(text("SET LOCAL ROLE bim_app"))
        rows = (await session.execute(text("SELECT * FROM models"))).all()
    assert rows == []


async def test_with_check_blocks_cross_org_model_insert(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_with_models: dict[str, UUID],
) -> None:
    """With GUC = org A, inserting a model under B's project must raise."""
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_with_models["a_org"])
        with pytest.raises(DBAPIError):
            await session.execute(
                text(
                    "INSERT INTO models (id, project_id, name, discipline, status) "
                    "VALUES (:id, :pid, 'sneaky', 'architectural', 'active')"
                ),
                {
                    "id": str(uuid4()),
                    "pid": str(two_orgs_with_models["b_project"]),
                },
            )


async def test_project_files_now_scope_through_models(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_with_models: dict[str, UUID],
) -> None:
    """Proves the rewritten project_files policy (model_id → projects → org)
    correctly blocks cross-org reads."""
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_with_models["a_org"])
        rows = (await session.execute(text("SELECT original_filename FROM project_files"))).all()
    assert sorted(r[0] for r in rows) == ["a.ifc"]

    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_with_models["b_org"])
        rows = (await session.execute(text("SELECT original_filename FROM project_files"))).all()
    assert sorted(r[0] for r in rows) == ["b.ifc"]
