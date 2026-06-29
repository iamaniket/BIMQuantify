"""Job orchestration: outbound dispatch to the processor worker, plus the
inbound shared-secret guard for callbacks. Replaces the older `bimdossier_api.extraction`
package, which was over-fitted to IFC."""

from bimdossier_api.jobs.dispatcher import (
    CancelResult,
    DispatchJobError,
    JobCanceller,
    JobConcurrencyError,
    JobDispatcher,
    cancel_dispatched_job,
    check_job_concurrency,
    dispatch_job,
    get_job_canceller,
    get_job_dispatcher,
    require_worker_secret,
    reset_job_canceller,
    reset_job_dispatcher,
    set_job_canceller,
    set_job_dispatcher,
)
from bimdossier_api.jobs.priority import (
    FREE_CALLBACK_PATH,
    FREE_PAGES_CALLBACK_PATH,
    FREE_TIER_SENTINEL_ORG,
    JobTier,
    resolve_priority,
)

__all__ = [
    "FREE_CALLBACK_PATH",
    "FREE_PAGES_CALLBACK_PATH",
    "FREE_TIER_SENTINEL_ORG",
    "CancelResult",
    "DispatchJobError",
    "JobCanceller",
    "JobConcurrencyError",
    "JobDispatcher",
    "JobTier",
    "cancel_dispatched_job",
    "check_job_concurrency",
    "dispatch_job",
    "get_job_canceller",
    "get_job_dispatcher",
    "require_worker_secret",
    "reset_job_canceller",
    "reset_job_dispatcher",
    "resolve_priority",
    "set_job_canceller",
    "set_job_dispatcher",
]
