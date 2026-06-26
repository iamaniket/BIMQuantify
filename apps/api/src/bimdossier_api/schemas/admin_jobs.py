"""Response schemas for the super-admin processor/extractor dashboard.

Read-only, cross-tenant. `AdminActiveJobs` is the live ongoing/stuck feed
aggregated across every active org schema; `ProcessorQueueStats` is the live
BullMQ queue depth proxied from the processor worker.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from bimdossier_api.schemas.job import JobListItem


class AdminJobItem(JobListItem):
    """A non-terminal job, annotated with its owning org and freshness.

    Extends the tenant `JobListItem` (no `payload`/`result`) with the
    cross-tenant context an admin needs: which org it belongs to, how long it
    has been in flight, and whether it has crossed the stuck-job timeout.
    """

    org_id: UUID
    org_name: str
    is_stuck: bool
    age_seconds: int


class AdminActiveJobsSummary(BaseModel):
    active: int  # all non-terminal jobs across all orgs
    stuck: int  # subset older than the stuck-job timeout


class AdminActiveJobs(BaseModel):
    summary: AdminActiveJobsSummary
    items: list[AdminJobItem]
    truncated: bool  # true when more non-terminal jobs existed than `limit`
    generated_at: datetime


class ProcessorQueueStats(BaseModel):
    """Live BullMQ counts proxied from the processor. Each value is a
    `{status: count}` map (waiting / active / completed / failed / delayed / …)
    passed through verbatim so new BullMQ statuses need no schema change.
    `completed`/`failed` are a recent retained window, not lifetime totals.
    """

    jobs: dict[str, int]
    actions: dict[str, int]
