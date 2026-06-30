"""Single-queue job priority by user tier (free-wedge decision D5).

Paying jobs sort ahead of free-tier jobs on the one shared BullMQ queue. These
tests assert ``dispatch_job`` threads the right BullMQ priority per tier and that
the configured values drive it. The recording dispatcher stub
(``_stub_job_dispatcher`` in conftest) captures the ``priority`` it was called
with.
"""

import uuid

from bimdossier_api.config import get_settings
from bimdossier_api.jobs import JobTier, dispatch_job, resolve_priority
from bimdossier_api.models.job import Job, JobType


def _make_job() -> Job:
    return Job(id=uuid.uuid4(), job_type=JobType.ifc_extraction, payload={})


def test_resolve_priority_uses_configured_values() -> None:
    settings = get_settings()
    assert resolve_priority(JobTier.paying, settings) == settings.job_priority_paying
    assert resolve_priority(JobTier.free, settings) == settings.job_priority_free
    # Contract: paying must outrank free (BullMQ: lower number = higher priority).
    assert settings.job_priority_paying < settings.job_priority_free


def test_resolve_priority_reads_settings_fields() -> None:
    settings = get_settings().model_copy(
        update={"job_priority_paying": 7, "job_priority_free": 77}
    )
    assert resolve_priority(JobTier.paying, settings) == 7
    assert resolve_priority(JobTier.free, settings) == 77


async def test_dispatch_defaults_to_paying_priority(
    job_dispatch_calls: list[dict[str, object]],
) -> None:
    settings = get_settings()
    await dispatch_job(_make_job(), settings, uuid.uuid4())
    assert len(job_dispatch_calls) == 1
    assert job_dispatch_calls[0]["priority"] == settings.job_priority_paying


async def test_dispatch_free_tier_uses_free_priority(
    job_dispatch_calls: list[dict[str, object]],
) -> None:
    settings = get_settings()
    await dispatch_job(_make_job(), settings, uuid.uuid4(), tier=JobTier.free)
    assert len(job_dispatch_calls) == 1
    assert job_dispatch_calls[0]["priority"] == settings.job_priority_free
