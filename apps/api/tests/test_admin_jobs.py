"""Tests for the super-admin processor/extractor monitoring endpoints.

Covers:
- `/admin/jobs/active` is superuser-only (403 otherwise).
- It aggregates non-terminal jobs across multiple org schemas, annotated with
  the owning org name, with correct active/stuck summary counts.
- Terminal (succeeded/failed/cancelled) jobs are excluded from the feed.
- `/admin/processor/queue-stats` proxies the processor payload, and maps an
  unreachable processor to 502 PROCESSOR_UNREACHABLE.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import text

from bimdossier_api.models.job import Job, JobStatus, JobType
from bimdossier_api.tenancy import schema_name_for
from tests.conftest import _auth

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


async def _insert_job(
    session_maker: async_sessionmaker[AsyncSession],
    schema: str,
    *,
    status: JobStatus,
    minutes_ago: int,
    job_type: JobType = JobType.ifc_extraction,
) -> UUID:
    async with session_maker() as session:
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))
        job = Job(
            job_type=job_type,
            status=status,
            payload={},
            created_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
        )
        session.add(job)
        await session.flush()
        job_id = job.id
        await session.commit()
    return job_id


def _schema(user: dict[str, str]) -> str:
    return schema_name_for(UUID(user["organization_id"]))


# ---------------------------------------------------------------------------
# /admin/jobs/active
# ---------------------------------------------------------------------------


async def test_active_jobs_requires_superuser(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """A non-superuser is rejected with 403."""
    resp = await client.get("/admin/jobs/active", headers=_auth(org_user["access_token"]))
    assert resp.status_code == 403


async def test_active_jobs_aggregates_across_orgs(
    client: AsyncClient,
    superuser_in_org: dict[str, str],
    org_user: dict[str, str],
    other_org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Non-terminal jobs from two different orgs both surface, annotated with
    their org name; the backdated one is flagged stuck."""
    fresh = await _insert_job(
        session_maker, _schema(org_user), status=JobStatus.running, minutes_ago=0
    )
    stuck = await _insert_job(
        session_maker,
        _schema(other_org_user),
        status=JobStatus.pending,
        minutes_ago=10_000,  # far past any stuck timeout
    )

    resp = await client.get(
        "/admin/jobs/active", headers=_auth(superuser_in_org["access_token"])
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    by_id = {item["id"]: item for item in body["items"]}
    assert str(fresh) in by_id
    assert str(stuck) in by_id

    assert by_id[str(fresh)]["org_name"] == "AlphaCo"
    assert by_id[str(fresh)]["is_stuck"] is False
    assert by_id[str(stuck)]["org_name"] == "BetaCo"
    assert by_id[str(stuck)]["is_stuck"] is True

    assert body["summary"]["active"] == 2
    assert body["summary"]["stuck"] == 1
    assert body["truncated"] is False


async def test_active_jobs_excludes_terminal(
    client: AsyncClient,
    superuser_in_org: dict[str, str],
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Succeeded/failed/cancelled jobs never appear in the live feed."""
    schema = _schema(org_user)
    await _insert_job(session_maker, schema, status=JobStatus.succeeded, minutes_ago=5)
    await _insert_job(session_maker, schema, status=JobStatus.failed, minutes_ago=5)
    await _insert_job(session_maker, schema, status=JobStatus.cancelled, minutes_ago=5)
    active = await _insert_job(
        session_maker, schema, status=JobStatus.running, minutes_ago=1
    )

    resp = await client.get(
        "/admin/jobs/active", headers=_auth(superuser_in_org["access_token"])
    )
    assert resp.status_code == 200, resp.text
    ids = {item["id"] for item in resp.json()["items"]}
    assert ids == {str(active)}
    assert resp.json()["summary"]["active"] == 1


# ---------------------------------------------------------------------------
# /admin/processor/queue-stats
# ---------------------------------------------------------------------------


async def test_queue_stats_proxies_processor(
    client: AsyncClient,
    superuser_in_org: dict[str, str],
) -> None:
    """The endpoint returns the processor's queue counts verbatim."""
    from bimdossier_api.jobs.dispatcher import (
        reset_queue_stats_fetcher,
        set_queue_stats_fetcher,
    )

    payload = {
        "jobs": {"waiting": 2, "active": 1, "completed": 9, "failed": 3, "delayed": 0},
        "actions": {"waiting": 0, "active": 0, "completed": 5, "failed": 0, "delayed": 0},
    }
    set_queue_stats_fetcher(lambda _settings: _async_return(payload))
    try:
        resp = await client.get(
            "/admin/processor/queue-stats",
            headers=_auth(superuser_in_org["access_token"]),
        )
    finally:
        reset_queue_stats_fetcher()

    assert resp.status_code == 200, resp.text
    assert resp.json() == payload


async def test_queue_stats_unreachable_processor(
    client: AsyncClient,
    superuser_in_org: dict[str, str],
) -> None:
    """An unreachable processor maps to 502 PROCESSOR_UNREACHABLE."""
    from bimdossier_api.jobs.dispatcher import (
        DispatchJobError,
        reset_queue_stats_fetcher,
        set_queue_stats_fetcher,
    )

    async def _boom(_settings: object) -> dict[str, dict[str, int]]:
        raise DispatchJobError("connection refused")

    set_queue_stats_fetcher(_boom)
    try:
        resp = await client.get(
            "/admin/processor/queue-stats",
            headers=_auth(superuser_in_org["access_token"]),
        )
    finally:
        reset_queue_stats_fetcher()

    assert resp.status_code == 502
    assert resp.json()["detail"] == "PROCESSOR_UNREACHABLE"


async def test_queue_stats_requires_superuser(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    resp = await client.get(
        "/admin/processor/queue-stats", headers=_auth(org_user["access_token"])
    )
    assert resp.status_code == 403


async def _async_return(value: object) -> object:
    return value
