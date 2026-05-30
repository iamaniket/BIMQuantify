"""Job orchestration: outbound dispatch to the processor worker, plus the
inbound shared-secret guard for callbacks. Replaces the older `bimstitch_api.extraction`
package, which was over-fitted to IFC."""

from bimstitch_api.jobs.dispatcher import (
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

__all__ = [
    "CancelResult",
    "DispatchJobError",
    "JobCanceller",
    "JobConcurrencyError",
    "JobDispatcher",
    "cancel_dispatched_job",
    "check_job_concurrency",
    "dispatch_job",
    "get_job_canceller",
    "get_job_dispatcher",
    "require_worker_secret",
    "reset_job_canceller",
    "reset_job_dispatcher",
    "set_job_canceller",
    "set_job_dispatcher",
]
