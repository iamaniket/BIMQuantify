"""Direct DB-level proof that Row-Level Security is enforced.

These tests bypass the HTTP layer and the tenant-session dependency. They open
raw sessions, set (or deliberately don't set) the GUCs, and assert that
PostgreSQL itself filters rows. If any of these fail, RLS isn't actually doing
its job — the app-layer filters become the only defense.
"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


async def _seed_org(session: AsyncSession, name: str) -> UUID:
    org_id = uuid4()
    await session.execute(
        text("INSERT INTO organizations (id, name) VALUES (:id, :name)"),
        {"id": str(org_id), "name": name},
    )
    return org_id


async def _seed_user(session: AsyncSession, email: str, org_id: UUID) -> UUID:
    user_id = uuid4()
    await session.execute(
        text(
            "INSERT INTO users (id, email, hashed_password, is_active, "
            "is_superuser, is_verified, organization_id) "
            "VALUES (:id, :email, 'x', true, false, true, :org)"
        ),
        {"id": str(user_id), "email": email, "org": str(org_id)},
    )
    return user_id


async def _seed_project(session: AsyncSession, org_id: UUID, owner_id: UUID, name: str) -> UUID:
    project_id = uuid4()
    await session.execute(
        text(
            "INSERT INTO projects (id, organization_id, name, owner_id) "
            "VALUES (:id, :org, :name, :owner)"
        ),
        {"id": str(project_id), "org": str(org_id), "name": name, "owner": str(owner_id)},
    )
    return project_id


async def _enter_tenant(session: AsyncSession, org_id: UUID) -> None:
    """Mirror what get_tenant_session does: switch to the non-bypass app role
    and set the GUC."""
    await session.execute(text("SET LOCAL ROLE bim_app"))
    await session.execute(
        text("SELECT set_config('app.current_org_id', :v, true)"),
        {"v": str(org_id)},
    )


async def _set_org_guc(session: AsyncSession, org_id: UUID) -> None:
    """Set the GUC without switching role — used by seed paths that need to
    insert across multiple orgs as the superuser bypassing RLS."""
    await session.execute(
        text("SELECT set_config('app.current_org_id', :v, true)"),
        {"v": str(org_id)},
    )


@pytest.fixture
async def two_orgs_seeded(
    session_maker: async_sessionmaker[AsyncSession],
) -> dict[str, UUID]:
    """Seed orgs A and B, one user and one project in each. Seeding is done in
    a session that sets BOTH org GUCs sequentially so RLS WITH CHECK passes.
    """
    async with session_maker() as session, session.begin():
        # Org A first.
        await _set_org_guc(session, uuid4())  # placeholder
        a_id = uuid4()
        await session.execute(
            text("INSERT INTO organizations (id, name) VALUES (:id, :n)"),
            {"id": str(a_id), "n": "RLS-A"},
        )
        # Now switch GUC to A so we can insert A's user + project.
        await _set_org_guc(session, a_id)
        a_user_id = uuid4()
        await session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_active, "
                "is_superuser, is_verified, organization_id) "
                "VALUES (:id, 'a@rls.test', 'x', true, false, true, :org)"
            ),
            {"id": str(a_user_id), "org": str(a_id)},
        )
        a_project_id = uuid4()
        await session.execute(
            text(
                "INSERT INTO projects (id, organization_id, name, owner_id) "
                "VALUES (:id, :org, 'A-proj', :owner)"
            ),
            {"id": str(a_project_id), "org": str(a_id), "owner": str(a_user_id)},
        )

        # Org B — switch GUC.
        b_id = uuid4()
        await session.execute(
            text("INSERT INTO organizations (id, name) VALUES (:id, :n)"),
            {"id": str(b_id), "n": "RLS-B"},
        )
        await _set_org_guc(session, b_id)
        b_user_id = uuid4()
        await session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_active, "
                "is_superuser, is_verified, organization_id) "
                "VALUES (:id, 'b@rls.test', 'x', true, false, true, :org)"
            ),
            {"id": str(b_user_id), "org": str(b_id)},
        )
        b_project_id = uuid4()
        await session.execute(
            text(
                "INSERT INTO projects (id, organization_id, name, owner_id) "
                "VALUES (:id, :org, 'B-proj', :owner)"
            ),
            {"id": str(b_project_id), "org": str(b_id), "owner": str(b_user_id)},
        )

    return {
        "a_org": a_id,
        "a_user": a_user_id,
        "a_project": a_project_id,
        "b_org": b_id,
        "b_user": b_user_id,
        "b_project": b_project_id,
    }


async def test_projects_visible_only_for_matching_org_guc(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_seeded: dict[str, UUID],
) -> None:
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_seeded["a_org"])
        rows = (await session.execute(text("SELECT name FROM projects"))).all()
    names = sorted(r[0] for r in rows)
    assert names == ["A-proj"]

    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_seeded["b_org"])
        rows = (await session.execute(text("SELECT name FROM projects"))).all()
    names = sorted(r[0] for r in rows)
    assert names == ["B-proj"]


async def test_projects_invisible_when_guc_unset(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_seeded: dict[str, UUID],
) -> None:
    async with session_maker() as session, session.begin():
        await session.execute(text("SET LOCAL ROLE bim_app"))
        # No GUC set in this txn.
        rows = (await session.execute(text("SELECT * FROM projects"))).all()
    assert rows == []


async def test_with_check_blocks_cross_org_insert(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_seeded: dict[str, UUID],
) -> None:
    """With GUC = org A, inserting a project with organization_id = B must
    raise. This proves WITH CHECK is enforced, not just USING."""
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_seeded["a_org"])
        with pytest.raises(DBAPIError):
            await session.execute(
                text(
                    "INSERT INTO projects (id, organization_id, name, owner_id) "
                    "VALUES (:id, :org, 'sneaky', :owner)"
                ),
                {
                    "id": str(uuid4()),
                    "org": str(two_orgs_seeded["b_org"]),
                    "owner": str(two_orgs_seeded["a_user"]),
                },
            )


async def test_users_invisible_across_orgs(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_seeded: dict[str, UUID],
) -> None:
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_seeded["a_org"])
        rows = (await session.execute(text("SELECT email FROM users"))).all()
    emails = sorted(r[0] for r in rows)
    assert emails == ["a@rls.test"]


async def test_users_self_read_carve_out(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_seeded: dict[str, UUID],
) -> None:
    """With app.current_org_id unset but app.current_user_id set, a user can
    read their own row. This is what keeps /users/me working even if the org
    GUC isn't set yet (e.g. mid-registration)."""
    async with session_maker() as session, session.begin():
        await session.execute(text("SET LOCAL ROLE bim_app"))
        await session.execute(
            text("SELECT set_config('app.current_user_id', :v, true)"),
            {"v": str(two_orgs_seeded["a_user"])},
        )
        rows = (
            await session.execute(
                text("SELECT email FROM users WHERE id = :id"),
                {"id": str(two_orgs_seeded["a_user"])},
            )
        ).all()
    assert len(rows) == 1
    assert rows[0][0] == "a@rls.test"


async def test_project_members_filtered_via_projects_subquery(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_seeded: dict[str, UUID],
) -> None:
    # Seed an owner membership in org A (the seed fixture only inserted the
    # project itself, not the corresponding owner row).
    async with session_maker() as session, session.begin():
        # Use raw superuser session (no SET ROLE) so RLS doesn't block the
        # cross-tenant seed setup.
        await session.execute(
            text(
                "INSERT INTO project_members (project_id, user_id, role) VALUES (:p, :u, 'owner')"
            ),
            {
                "p": str(two_orgs_seeded["a_project"]),
                "u": str(two_orgs_seeded["a_user"]),
            },
        )

    # With org A GUC, see A's membership; with B GUC, see none.
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_seeded["a_org"])
        a_rows = (await session.execute(text("SELECT * FROM project_members"))).all()
    assert len(a_rows) == 1

    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_seeded["b_org"])
        b_rows = (await session.execute(text("SELECT * FROM project_members"))).all()
    assert b_rows == []
