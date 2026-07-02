"""Lifetime findings counter — `public.pooled_finding_counters`.

The free findings cap (`FREE_MAX_FINDINGS_PER_USER` / `free_user_limits.max_findings`)
has LIFETIME semantics: it counts every finding EVER created against a project
owner — open, closed, and deleted. Pooled findings are hard-deleted, so a live
`COUNT(*)` would decrement on delete and let a user cycle create→delete forever;
this monotonic counter is the persistent record the cap is enforced against.

One row per project OWNER (members' snags count against the owner, mirroring
`pooled_findings.owner_user_id`). The row is upserted (+1) in the SAME pooled
transaction as each finding INSERT — never decremented — under the existing
per-owner advisory lock, so the read-check + increment is race-safe.

Unlike `free_user_limits` (control-plane, superuser-only) this is DATA-PLANE:
the pooled `bim_app` session writes it on every snag create, so it carries an
owner-OR-participant RLS policy and a `bim_app` grant (see `_rls_sql.py`).
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase


class PooledFindingCounter(MasterBase):
    __tablename__ = "pooled_finding_counters"

    # One row per project owner (PK == FK). CASCADE so an anonymized/deleted
    # user takes their counter with them.
    owner_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Total findings ever created against this owner's projects. Monotonic:
    # incremented at snag-create, never decremented (deletes don't free quota).
    lifetime_created: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = ({"schema": "public"},)
