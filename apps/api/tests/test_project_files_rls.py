"""DB-level RLS isolation for project_files. Mirrors test_projects_rls.py but
proves that a row in another org's project is invisible under the bim_app role.
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
async def two_orgs_with_files(
    session_maker: async_sessionmaker[AsyncSession],
) -> dict[str, UUID]:
    """Seed two orgs, each with a user + project + project_file, as the
    superuser (RLS doesn't apply since we never SET ROLE bim_app here)."""
    async with session_maker() as session, session.begin():
        a_org = uuid4()
        await session.execute(
            text("INSERT INTO organizations (id, name) VALUES (:id, 'RLS-A')"),
            {"id": str(a_org)},
        )
        a_user = uuid4()
        await session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_active, "
                "is_superuser, is_verified, organization_id) "
                "VALUES (:id, 'a@files.test', 'x', true, false, true, :org)"
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
        a_file = uuid4()
        await session.execute(
            text(
                "INSERT INTO project_files "
                "(id, project_id, uploaded_by_user_id, storage_key, original_filename, "
                "size_bytes, content_type, status) "
                "VALUES (:id, :pid, :uid, :sk, 'a.ifc', 100, 'application/octet-stream', 'ready')"
            ),
            {
                "id": str(a_file),
                "pid": str(a_project),
                "uid": str(a_user),
                "sk": f"projects/{a_project}/{a_file}.ifc",
            },
        )

        b_org = uuid4()
        await session.execute(
            text("INSERT INTO organizations (id, name) VALUES (:id, 'RLS-B')"),
            {"id": str(b_org)},
        )
        b_user = uuid4()
        await session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_active, "
                "is_superuser, is_verified, organization_id) "
                "VALUES (:id, 'b@files.test', 'x', true, false, true, :org)"
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
        b_file = uuid4()
        await session.execute(
            text(
                "INSERT INTO project_files "
                "(id, project_id, uploaded_by_user_id, storage_key, original_filename, "
                "size_bytes, content_type, status) "
                "VALUES (:id, :pid, :uid, :sk, 'b.ifc', 200, 'application/octet-stream', 'ready')"
            ),
            {
                "id": str(b_file),
                "pid": str(b_project),
                "uid": str(b_user),
                "sk": f"projects/{b_project}/{b_file}.ifc",
            },
        )

    return {
        "a_org": a_org,
        "a_user": a_user,
        "a_project": a_project,
        "a_file": a_file,
        "b_org": b_org,
        "b_user": b_user,
        "b_project": b_project,
        "b_file": b_file,
    }


async def test_project_files_visible_only_for_matching_org(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_with_files: dict[str, UUID],
) -> None:
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_with_files["a_org"])
        rows = (await session.execute(text("SELECT original_filename FROM project_files"))).all()
    assert sorted(r[0] for r in rows) == ["a.ifc"]

    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_with_files["b_org"])
        rows = (await session.execute(text("SELECT original_filename FROM project_files"))).all()
    assert sorted(r[0] for r in rows) == ["b.ifc"]


async def test_project_files_invisible_when_guc_unset(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_with_files: dict[str, UUID],
) -> None:
    async with session_maker() as session, session.begin():
        await session.execute(text("SET LOCAL ROLE bim_app"))
        rows = (await session.execute(text("SELECT * FROM project_files"))).all()
    assert rows == []


async def test_with_check_blocks_cross_org_file_insert(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_with_files: dict[str, UUID],
) -> None:
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_with_files["a_org"])
        with pytest.raises(DBAPIError):
            await session.execute(
                text(
                    "INSERT INTO project_files "
                    "(id, project_id, uploaded_by_user_id, storage_key, original_filename, "
                    "size_bytes, content_type, status) "
                    "VALUES (:id, :pid, :uid, :sk, 'sneaky.ifc', 1, 'x', 'ready')"
                ),
                {
                    "id": str(uuid4()),
                    "pid": str(two_orgs_with_files["b_project"]),
                    "uid": str(two_orgs_with_files["a_user"]),
                    "sk": f"x/{uuid4()}.ifc",
                },
            )
