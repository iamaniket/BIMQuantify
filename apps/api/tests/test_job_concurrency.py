"""M-con2: the per-org active-job cap is enforced atomically.

`check_job_concurrency` takes a transaction-scoped advisory lock keyed on the
active org before its COUNT, so two concurrent job creations cannot both pass a
check-then-insert and overshoot ``MAX_CONCURRENT_JOBS_PER_ORG``.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import func, select

from bimdossier_api.config import get_settings
from bimdossier_api.jobs.dispatcher import JobConcurrencyError, check_job_concurrency
from bimdossier_api.models.job import Job, JobStatus, JobType
from bimdossier_api.tenancy import open_tenant_session, schema_name_for

if TYPE_CHECKING:
    from httpx import AsyncClient

    from tests.conftest import FakeStorage


async def test_concurrent_job_creation_cannot_exceed_cap(
    org_user: dict[str, str],
    fake_storage_client: tuple[AsyncClient, FakeStorage],
) -> None:
    """Two job creations racing on the last free slot must not both land.

    With the advisory lock the count-then-insert is serialized per org: exactly
    one creation succeeds, the other gets ``JobConcurrencyError``. Without it
    both reads see room and both insert, overshooting the cap.
    """
    org_id = UUID(org_user["organization_id"])
    user_id = UUID(org_user["id"])
    schema = schema_name_for(org_id)

    # One free slot (org starts with zero active jobs).
    settings = get_settings().model_copy(update={"max_concurrent_jobs_per_org": 1})

    async def _create_one() -> str:
        try:
            async with open_tenant_session(schema, org_id, user_id) as session:
                await check_job_concurrency(session, settings)
                session.add(
                    Job(
                        job_type=JobType.compliance_check,
                        status=JobStatus.pending,
                        payload={},
                    )
                )
                await session.flush()
            return "ok"
        except JobConcurrencyError:
            return "rejected"

    results = await asyncio.gather(_create_one(), _create_one())
    assert sorted(results) == ["ok", "rejected"]

    # The cap held: exactly one active job, never two.
    async with open_tenant_session(schema, org_id, user_id) as session:
        active = await session.scalar(
            select(func.count())
            .select_from(Job)
            .where(Job.status == JobStatus.pending)
        )
    assert active == 1
