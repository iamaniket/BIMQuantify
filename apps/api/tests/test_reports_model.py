"""Direct DB-level tests for the `reports` table — schema + RLS isolation.

Mirrors the pattern in test_projects_rls.py: bypass HTTP, manipulate raw
sessions, and prove that PostgreSQL itself filters cross-org rows.
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
async def two_orgs_with_projects(
    session_maker: async_sessionmaker[AsyncSession],
) -> dict[str, UUID]:
    """Seed two orgs with one project each. Returns the IDs we need."""
    async with session_maker() as session, session.begin():
        a_id = uuid4()
        b_id = uuid4()
        await session.execute(
            text("INSERT INTO organizations (id, name) VALUES (:id, :n)"),
            {"id": str(a_id), "n": "Reports-A"},
        )
        await session.execute(
            text("INSERT INTO organizations (id, name) VALUES (:id, :n)"),
            {"id": str(b_id), "n": "Reports-B"},
        )

        a_user = uuid4()
        b_user = uuid4()
        await session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_active, "
                "is_superuser, is_verified, organization_id) "
                "VALUES (:id, 'a@reports.test', 'x', true, false, true, :org)"
            ),
            {"id": str(a_user), "org": str(a_id)},
        )
        await session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_active, "
                "is_superuser, is_verified, organization_id) "
                "VALUES (:id, 'b@reports.test', 'x', true, false, true, :org)"
            ),
            {"id": str(b_user), "org": str(b_id)},
        )

        a_proj = uuid4()
        b_proj = uuid4()
        await session.execute(
            text(
                "INSERT INTO projects (id, organization_id, name, owner_id) "
                "VALUES (:id, :org, 'A-proj', :owner)"
            ),
            {"id": str(a_proj), "org": str(a_id), "owner": str(a_user)},
        )
        await session.execute(
            text(
                "INSERT INTO projects (id, organization_id, name, owner_id) "
                "VALUES (:id, :org, 'B-proj', :owner)"
            ),
            {"id": str(b_proj), "org": str(b_id), "owner": str(b_user)},
        )

    return {
        "a_org": a_id,
        "a_user": a_user,
        "a_project": a_proj,
        "b_org": b_id,
        "b_user": b_user,
        "b_project": b_proj,
    }


async def _seed_report(
    session: AsyncSession, org_id: UUID, project_id: UUID, title: str
) -> UUID:
    rid = uuid4()
    await session.execute(
        text(
            "INSERT INTO reports (id, organization_id, project_id, report_type, "
            "status, title, locale) VALUES (:id, :org, :p, 'compliance_report', "
            "'queued', :title, 'nl')"
        ),
        {"id": str(rid), "org": str(org_id), "p": str(project_id), "title": title},
    )
    return rid


# ---------------------------------------------------------------------------
# Schema sanity
# ---------------------------------------------------------------------------


async def test_reports_table_exists_with_expected_columns(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session, session.begin():
        rows = (
            await session.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'reports' ORDER BY ordinal_position"
                )
            )
        ).all()
    cols = {r[0] for r in rows}
    expected = {
        "id",
        "organization_id",
        "project_id",
        "report_type",
        "status",
        "job_id",
        "source_job_id",
        "storage_key",
        "byte_size",
        "sha256",
        "title",
        "locale",
        "params",
        "error",
        "created_by_user_id",
        "finished_at",
        "created_at",
        "updated_at",
    }
    missing = expected - cols
    assert not missing, f"reports table is missing columns: {missing}"


async def test_compliance_report_jobtype_value_present(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session, session.begin():
        rows = (
            await session.execute(
                text(
                    "SELECT enumlabel FROM pg_enum e "
                    "JOIN pg_type t ON e.enumtypid = t.oid "
                    "WHERE t.typname = 'jobtype'"
                )
            )
        ).all()
    labels = {r[0] for r in rows}
    assert "compliance_report" in labels


# ---------------------------------------------------------------------------
# RLS isolation
# ---------------------------------------------------------------------------


async def test_reports_visible_only_for_matching_org_guc(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_with_projects: dict[str, UUID],
) -> None:
    # Seed one report per org under superuser (RLS-bypass).
    async with session_maker() as session, session.begin():
        await _seed_report(
            session, two_orgs_with_projects["a_org"], two_orgs_with_projects["a_project"], "A-report"
        )
        await _seed_report(
            session, two_orgs_with_projects["b_org"], two_orgs_with_projects["b_project"], "B-report"
        )

    # Org A sees only A.
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_with_projects["a_org"])
        rows = (await session.execute(text("SELECT title FROM reports"))).all()
    assert sorted(r[0] for r in rows) == ["A-report"]

    # Org B sees only B.
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_with_projects["b_org"])
        rows = (await session.execute(text("SELECT title FROM reports"))).all()
    assert sorted(r[0] for r in rows) == ["B-report"]


async def test_reports_invisible_when_guc_unset(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_with_projects: dict[str, UUID],
) -> None:
    async with session_maker() as session, session.begin():
        await _seed_report(
            session, two_orgs_with_projects["a_org"], two_orgs_with_projects["a_project"], "A1"
        )

    async with session_maker() as session, session.begin():
        await session.execute(text("SET LOCAL ROLE bim_app"))
        # No GUC set.
        rows = (await session.execute(text("SELECT * FROM reports"))).all()
    assert rows == []


async def test_reports_with_check_blocks_cross_org_insert(
    session_maker: async_sessionmaker[AsyncSession],
    two_orgs_with_projects: dict[str, UUID],
) -> None:
    """While GUC = org A, attempting to insert a report with organization_id = B
    must fail. Proves WITH CHECK is enforced, not just USING."""
    async with session_maker() as session, session.begin():
        await _enter_tenant(session, two_orgs_with_projects["a_org"])
        with pytest.raises(DBAPIError):
            await session.execute(
                text(
                    "INSERT INTO reports (id, organization_id, project_id, "
                    "report_type, status, title, locale) "
                    "VALUES (:id, :org, :p, 'compliance_report', 'queued', 'sneaky', 'nl')"
                ),
                {
                    "id": str(uuid4()),
                    # Wrong org — must be rejected by WITH CHECK.
                    "org": str(two_orgs_with_projects["b_org"]),
                    "p": str(two_orgs_with_projects["b_project"]),
                },
            )
