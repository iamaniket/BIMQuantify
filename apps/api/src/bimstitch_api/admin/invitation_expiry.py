"""Background sweep that expires stale pending invitations.

Pending OrganizationMember rows count toward the org's seat_limit. If
they live forever, an admin who invites and walks away silently locks
seats. The sweep flips any pending row older than `INVITATION_TTL_DAYS`
to `removed`, frees the seat, and writes an audit entry per row.

Resending an invite resets `invited_at` (see `resend_invite` in the
organization_members router), so the sweep skips actively-managed
invites naturally.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api import audit
from bimstitch_api.config import get_settings
from bimstitch_api.db import get_session_maker
from bimstitch_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)

logger = logging.getLogger(__name__)


async def sweep_expired_invitations(session: AsyncSession, ttl_days: int) -> int:
    """Flip every expired pending row to `removed`, audit each one, and
    return the count. Caller commits.

    Iterates instead of bulk-updating because we need a per-row audit
    entry for traceability — admins want to know *why* a seat freed up.
    """
    cutoff = datetime.now(UTC) - timedelta(days=ttl_days)
    stmt = select(OrganizationMember).where(
        OrganizationMember.status == OrganizationMemberStatus.pending,
        OrganizationMember.invited_at < cutoff,
    )
    result = await session.execute(stmt)
    expired = list(result.scalars())

    for member in expired:
        before = {"status": member.status.value}
        member.status = OrganizationMemberStatus.removed
        await audit.record(
            session,
            action="organization_member.invitation_expired",
            resource_type="organization_member",
            resource_id=member.id,
            before=before,
            after={"status": member.status.value},
            actor_user_id=None,  # System action
            organization_id=member.organization_id,
            request=None,
        )

    return len(expired)


async def _sweep_once() -> None:
    """One-shot sweep using a fresh session. Exceptions are logged and
    swallowed so a transient DB hiccup doesn't kill the scheduler loop.
    """
    settings = get_settings()
    session_maker = get_session_maker()
    try:
        async with session_maker() as session:
            count = await sweep_expired_invitations(session, settings.invitation_ttl_days)
            await session.commit()
            if count:
                logger.info("invitation_expiry: swept %d expired invites", count)
    except Exception:
        logger.exception("invitation_expiry sweep failed")


class InvitationExpirySweeper:
    """Runs `_sweep_once` on an interval inside the API process.

    Lifespan: `start()` schedules the task, `stop()` cancels and awaits
    it. Set `interval_minutes=0` to disable (useful in tests or when a
    cron handles it externally).
    """

    def __init__(self, interval_minutes: int) -> None:
        self.interval_seconds = interval_minutes * 60
        self._task: asyncio.Task[None] | None = None

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self.interval_seconds)
                await _sweep_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("invitation_expiry loop iteration failed")

    def start(self) -> None:
        if self.interval_seconds <= 0:
            logger.info("invitation_expiry sweeper disabled (interval=0)")
            return
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._loop(), name="invitation_expiry_sweeper")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
