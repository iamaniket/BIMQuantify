"""Tests for the stuck-job reconciliation sweep (job recovery backstop).

Covers:
- A non-terminal job older than the stuck timeout is force-failed, and the
  failure cascades to the linked file's extraction status.
- A fresh job (younger than the timeout) is left untouched.
- A non-terminal report older than the timeout is force-failed independently.
- The sweep is idempotent: a second pass does not re-touch an already-failed
  row (its `finished_at` is preserved).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select, text

from bimdossier_api.models.job import Job, JobStatus, JobType
from bimdossier_api.models.project_file import ExtractionStatus, ProjectFile
from bimdossier_api.models.report import Report, ReportStatus, ReportType
from tests.conftest import FakeStorage, _auth, _create_project
from tests.test_jobs import _ready_ifc

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _org_schema(org_user: dict[str, str]) -> str:
    from bimdossier_api.tenancy import schema_name_for

    return schema_name_for(UUID(org_user["organization_id"]))


async def _backdate_job(
    session_maker: async_sessionmaker[AsyncSession],
    schema: str,
    job_id: str,
    *,
    minutes_ago: int,
) -> None:
    async with session_maker() as session:
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        job = (await session.execute(select(Job).where(Job.id == UUID(job_id)))).scalar_one()
        job.created_at = datetime.now(UTC) - timedelta(minutes=minutes_ago)
        await session.commit()


async def _set_file_extraction(
    session_maker: async_sessionmaker[AsyncSession],
    schema: str,
    file_id: str,
    status: ExtractionStatus,
) -> None:
    async with session_maker() as session:
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        pf = (
            await session.execute(select(ProjectFile).where(ProjectFile.id == UUID(file_id)))
        ).scalar_one()
        pf.extraction_status = status
        await session.commit()


async def _insert_job(
    session_maker: async_sessionmaker[AsyncSession],
    schema: str,
    *,
    status: JobStatus,
    minutes_ago: int,
) -> UUID:
    async with session_maker() as session:
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        job = Job(
            job_type=JobType.compliance_check,
            status=status,
            payload={},
            created_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
        )
        session.add(job)
        await session.flush()
        job_id = job.id
        await session.commit()
    return job_id


async def _insert_report(
    session_maker: async_sessionmaker[AsyncSession],
    schema: str,
    project_id: str,
    *,
    status: ReportStatus,
    minutes_ago: int,
) -> UUID:
    async with session_maker() as session:
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        report = Report(
            project_id=UUID(project_id),
            report_type=ReportType.compliance_report,
            status=status,
            title="Stuck report",
            locale="en",
            created_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
        )
        session.add(report)
        await session.flush()
        report_id = report.id
        await session.commit()
    return report_id


async def _job_state(
    session_maker: async_sessionmaker[AsyncSession],
    schema: str,
    job_id: str | UUID,
) -> tuple[JobStatus, str | None, datetime | None]:
    async with session_maker() as session:
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        job = (
            await session.execute(select(Job).where(Job.id == UUID(str(job_id))))
        ).scalar_one()
        return job.status, job.error, job.finished_at


async def _file_state(
    session_maker: async_sessionmaker[AsyncSession],
    schema: str,
    file_id: str,
) -> tuple[ExtractionStatus, str | None, datetime | None]:
    async with session_maker() as session:
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        pf = (
            await session.execute(select(ProjectFile).where(ProjectFile.id == UUID(file_id)))
        ).scalar_one()
        return pf.extraction_status, pf.extraction_error, pf.extraction_finished_at


async def _report_state(
    session_maker: async_sessionmaker[AsyncSession],
    schema: str,
    report_id: UUID,
) -> tuple[ReportStatus, str | None, datetime | None]:
    async with session_maker() as session:
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        report = (
            await session.execute(select(Report).where(Report.id == report_id))
        ).scalar_one()
        return report.status, report.error, report.finished_at


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_stuck_job_force_failed_with_file_cascade(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A job stuck past the timeout is failed, and its file extraction too."""
    from bimdossier_api.jobs.reconcile import sweep_all_orgs

    client, fake = fake_storage_client
    _project_id, _document_id, file_id = await _ready_ifc(client, fake, org_user, name="stuck.ifc")
    schema = _org_schema(org_user)

    job_id = (
        await client.get("/jobs", headers=_auth(org_user["access_token"]))
    ).json()["items"][0]["id"]

    await _backdate_job(session_maker, schema, job_id, minutes_ago=120)
    await _set_file_extraction(session_maker, schema, file_id, ExtractionStatus.running)

    failed = await sweep_all_orgs(stuck_timeout_minutes=60)
    assert failed >= 1

    status, error, finished_at = await _job_state(session_maker, schema, job_id)
    assert status == JobStatus.failed
    assert error is not None
    assert finished_at is not None

    f_status, f_error, f_finished = await _file_state(session_maker, schema, file_id)
    assert f_status == ExtractionStatus.failed
    assert f_error is not None
    assert f_finished is not None


async def test_fresh_job_not_reaped(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A job younger than the timeout is left in its current state."""
    from bimdossier_api.jobs.reconcile import sweep_all_orgs

    client, fake = fake_storage_client
    await _ready_ifc(client, fake, org_user, name="fresh.ifc")
    schema = _org_schema(org_user)

    job_id = (
        await client.get("/jobs", headers=_auth(org_user["access_token"]))
    ).json()["items"][0]["id"]

    await sweep_all_orgs(stuck_timeout_minutes=60)

    status, _error, finished_at = await _job_state(session_maker, schema, job_id)
    assert status == JobStatus.pending
    assert finished_at is None


async def test_stuck_report_force_failed(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A report stuck in `running` past the timeout is force-failed."""
    from bimdossier_api.jobs.reconcile import sweep_all_orgs

    client, _fake = fake_storage_client
    project = await _create_project(client, org_user["access_token"], name="report-stuck")
    schema = _org_schema(org_user)

    report_id = await _insert_report(
        session_maker, schema, project["id"], status=ReportStatus.running, minutes_ago=120
    )

    await sweep_all_orgs(stuck_timeout_minutes=60)

    status, error, finished_at = await _report_state(session_maker, schema, report_id)
    assert status == ReportStatus.failed
    assert error is not None
    assert finished_at is not None


async def test_reconcile_is_idempotent(
    org_user: dict[str, str],
    email_transport: object,
    fake_storage_client: tuple[AsyncClient, FakeStorage],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A second sweep does not re-touch an already-failed job."""
    from bimdossier_api.jobs.reconcile import sweep_all_orgs

    schema = _org_schema(org_user)
    job_id = await _insert_job(
        session_maker, schema, status=JobStatus.running, minutes_ago=120
    )

    await sweep_all_orgs(stuck_timeout_minutes=60)
    status_1, _error_1, finished_1 = await _job_state(session_maker, schema, job_id)
    assert status_1 == JobStatus.failed
    assert finished_1 is not None

    await sweep_all_orgs(stuck_timeout_minutes=60)
    status_2, _error_2, finished_2 = await _job_state(session_maker, schema, job_id)
    assert status_2 == JobStatus.failed
    # The second sweep skipped it (already terminal), so finished_at is unchanged.
    assert finished_2 == finished_1
