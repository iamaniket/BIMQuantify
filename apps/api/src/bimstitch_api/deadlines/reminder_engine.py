"""Background sweep that sends deadline reminder and missed-deadline alerts.

Follows the ``InvitationExpirySweeper`` pattern: asyncio task running on a
configurable interval inside the API process lifespan. Each sweep iterates
all active orgs, switches to their tenant schema, and processes every
pending deadline.

Idempotency: before sending, the sweep checks ``deadline_notification_log``
for an existing row matching (deadline_id, notification_type, days_before).
If found, the notification was already sent — skip. After a successful
send, the log row is inserted in the same flush so a crash before commit
means a retry on the next sweep, but never a double-send after commit.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.actions.dispatcher import dispatch_action
from bimstitch_api.config import get_settings
from bimstitch_api.db import get_session_maker
from bimstitch_api.deadlines.settings import get_effective_settings
from bimstitch_api.jobs.dispatcher import DispatchJobError
from bimstitch_api.jurisdictions import get_deadline_rules, pick_label
from bimstitch_api.models.deadline import Deadline, DeadlineStatus
from bimstitch_api.models.deadline_notification_log import DeadlineNotificationLog
from bimstitch_api.models.notification import NotificationEventType
from bimstitch_api.models.organization import Organization, OrganizationStatus
from bimstitch_api.models.project import Project
from bimstitch_api.models.project_member import ProjectMember
from bimstitch_api.models.user import User
from bimstitch_api.notifications.service import (
    create_notification,
    publish_notification,
)

logger = logging.getLogger(__name__)

_AMS = ZoneInfo("Europe/Amsterdam")


# ---------------------------------------------------------------------------
# Sweep logic
# ---------------------------------------------------------------------------


async def _already_sent(
    session: AsyncSession,
    deadline_id: UUID,
    notification_type: str,
    days_before: int | None,
) -> bool:
    """Check the idempotency log for an existing send."""
    stmt = select(DeadlineNotificationLog.id).where(
        DeadlineNotificationLog.deadline_id == deadline_id,
        DeadlineNotificationLog.notification_type == notification_type,
    )
    if days_before is not None:
        stmt = stmt.where(DeadlineNotificationLog.days_before == days_before)
    else:
        stmt = stmt.where(DeadlineNotificationLog.days_before.is_(None))
    return (await session.execute(stmt)).scalar_one_or_none() is not None


async def _record_sent(
    session: AsyncSession,
    deadline_id: UUID,
    notification_type: str,
    days_before: int | None,
) -> None:
    """Insert an idempotency log row."""
    session.add(
        DeadlineNotificationLog(
            deadline_id=deadline_id,
            notification_type=notification_type,
            days_before=days_before,
        )
    )
    await session.flush()


async def _get_recipients(
    session: AsyncSession,
    project_id: UUID,
    recipient_roles: list[str],
) -> list[User]:
    """Load users who are project members with the given roles."""
    stmt = (
        select(User)
        .join(ProjectMember, ProjectMember.user_id == User.id)
        .where(
            ProjectMember.project_id == project_id,
            ProjectMember.role.in_(recipient_roles),
        )
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def _sweep_deadline(
    session: AsyncSession,
    deadline: Deadline,
    project: Project,
    organization_id: UUID,
    today: date,
) -> None:
    """Process a single deadline: check reminders + missed."""
    if deadline.due_date is None:
        return

    # Resolve effective notification settings.
    effective = await get_effective_settings(
        session,
        project.id,
        deadline.deadline_type,
        project.country,
    )
    if effective is None or not effective.enabled:
        return

    settings = get_settings()
    project_url = f"{settings.frontend_project_url}/{project.id}"

    # Find the jurisdiction rule for this deadline type (for labels).
    rules = get_deadline_rules(project.country)
    rule = next((r for r in rules if r.deadline_type == deadline.deadline_type), None)
    if rule is None:
        return

    label_nl = pick_label(rule.label, "nl", "nl")
    label_en = pick_label(rule.label, "en", "en")

    days_until_due = (deadline.due_date - today).days

    # --- Reminders (days_until_due >= 0) ---
    if days_until_due >= 0:
        # Find the most specific (smallest) applicable tier. For tiers
        # [14, 7, 3, 1] and days_until_due=6, the applicable tier is 7
        # (the smallest tier >= days_until_due). Iterate descending so
        # the last match is the most specific.
        applicable_tier: int | None = None
        for tier in sorted(effective.reminder_days, reverse=True):
            if days_until_due <= tier:
                applicable_tier = tier

        if applicable_tier is not None and not await _already_sent(
            session, deadline.id, "reminder", applicable_tier
        ):
            recipients = await _get_recipients(session, project.id, effective.recipient_roles)
            days_word_nl = "dag" if days_until_due == 1 else "dagen"
            days_word_en = "day" if days_until_due == 1 else "days"
            due_str = deadline.due_date.isoformat()

            for user in recipients:
                name = user.full_name or user.email
                body = (
                    f"Hi {name},\n\n"
                    f'Reminder: the deadline "{label_en}" for project '
                    f'"{project.name}" is due on {due_str} '
                    f"({days_until_due} {days_word_en} remaining).\n\n"
                    f"---\n\n"
                    f'Herinnering: de deadline "{label_nl}" voor project '
                    f'"{project.name}" vervalt op {due_str} '
                    f"(nog {days_until_due} {days_word_nl})."
                )
                try:
                    await dispatch_action(
                        "send_email",
                        {
                            "to": user.email,
                            "subject": f"Deadline reminder: {label_en} — {project.name}",
                            "body": body,
                            "action_url": project_url,
                            "action_label": "View project",
                            "type": "reminder",
                        },
                        settings,
                        organization_id,
                    )
                except DispatchJobError:
                    logger.exception(
                        "Failed to dispatch reminder email to %s for deadline %s",
                        user.email,
                        deadline.id,
                    )

            # In-app notification
            try:
                notification = await create_notification(
                    session,
                    event_type=NotificationEventType.deadline_upcoming,
                    title=f"Deadline reminder: {label_en}",
                    body=(
                        f'The deadline "{label_en}" for project '
                        f'"{project.name}" is due in '
                        f"{days_until_due} days."
                    ),
                    project_id=project.id,
                )
                await publish_notification(notification, organization_id=organization_id)
            except Exception:
                logger.exception(
                    "Failed to create in-app notification for deadline %s",
                    deadline.id,
                )

            await _record_sent(session, deadline.id, "reminder", applicable_tier)

    # --- Missed (days_until_due < 0) ---
    if days_until_due < 0:
        if await _already_sent(session, deadline.id, "missed", None):
            return

        recipients = await _get_recipients(session, project.id, effective.recipient_roles)
        due_str = deadline.due_date.isoformat()

        for user in recipients:
            name = user.full_name or user.email
            body = (
                f"Hi {name},\n\n"
                f'The deadline "{label_en}" for project '
                f'"{project.name}" was due on {due_str} and has not been met.\n\n'
                f"Please take action as soon as possible.\n\n"
                f"---\n\n"
                f'De deadline "{label_nl}" voor project '
                f'"{project.name}" is op {due_str} verlopen en is niet afgehandeld.\n\n'
                f"Onderneem zo snel mogelijk actie."
            )
            try:
                await dispatch_action(
                    "send_email",
                    {
                        "to": user.email,
                        "subject": f"Missed deadline: {label_en} — {project.name}",
                        "body": body,
                        "action_url": project_url,
                        "action_label": "View project",
                        "type": "alert",
                    },
                    settings,
                    organization_id,
                )
            except DispatchJobError:
                logger.exception(
                    "Failed to dispatch missed-deadline email to %s for deadline %s",
                    user.email,
                    deadline.id,
                )

        # In-app notification
        try:
            notification = await create_notification(
                session,
                event_type=NotificationEventType.deadline_missed,
                title=f"Missed deadline: {label_en}",
                body=(
                    f'The deadline "{label_en}" for project '
                    f'"{project.name}" was due on '
                    f"{deadline.due_date.isoformat()} and has not been met."
                ),
                project_id=project.id,
            )
            await publish_notification(notification, organization_id=organization_id)
        except Exception:
            logger.exception(
                "Failed to create in-app notification for missed deadline %s",
                deadline.id,
            )

        await _record_sent(session, deadline.id, "missed", None)


async def _sweep_org(
    org_id: UUID,
    schema: str,
) -> int:
    """Sweep all pending deadlines in one tenant schema. Returns count processed."""
    session_maker = get_session_maker()
    count = 0
    today = datetime.now(_AMS).date()

    async with session_maker() as session, session.begin():
        await session.execute(text(f'SET LOCAL search_path = "{schema}", public'))

        # Load all pending deadlines with a due_date.
        stmt = select(Deadline).where(
            Deadline.status == DeadlineStatus.pending,
            Deadline.due_date.isnot(None),
        )
        deadlines = list((await session.execute(stmt)).scalars().all())

        if not deadlines:
            return 0

        # Pre-load projects for these deadlines.
        project_ids = {d.project_id for d in deadlines}
        projects_result = await session.execute(select(Project).where(Project.id.in_(project_ids)))
        projects_by_id = {p.id: p for p in projects_result.scalars().all()}

        for deadline in deadlines:
            project = projects_by_id.get(deadline.project_id)
            if project is None:
                continue
            try:
                await _sweep_deadline(session, deadline, project, org_id, today)
                count += 1
            except Exception:
                logger.exception(
                    "Error processing deadline %s in schema %s",
                    deadline.id,
                    schema,
                )

    return count


async def sweep_all_orgs() -> int:
    """One-shot sweep across all active orgs. Returns total deadlines processed."""
    session_maker = get_session_maker()
    total = 0

    async with session_maker() as session:
        result = await session.execute(
            select(Organization.id, Organization.schema_name).where(
                Organization.status == OrganizationStatus.active,
                Organization.deleted_at.is_(None),
            )
        )
        orgs = list(result.all())

    for org_id, schema in orgs:
        try:
            count = await _sweep_org(org_id, schema)
            total += count
        except Exception:
            logger.exception("Deadline sweep failed for org %s", org_id)

    if total:
        logger.info("deadline_reminder: processed %d deadlines across %d orgs", total, len(orgs))
    return total


# ---------------------------------------------------------------------------
# Sweeper class (lifespan-managed)
# ---------------------------------------------------------------------------


class DeadlineReminderSweeper:
    """Runs ``sweep_all_orgs`` on an interval inside the API process.

    Mirrors ``InvitationExpirySweeper``: ``start()`` schedules the task,
    ``stop()`` cancels and awaits it. Set ``interval_minutes=0`` to disable.
    """

    def __init__(self, interval_minutes: int) -> None:
        self.interval_seconds = interval_minutes * 60
        self._task: asyncio.Task[None] | None = None

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self.interval_seconds)
                await sweep_all_orgs()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("deadline_reminder loop iteration failed")

    def start(self) -> None:
        if self.interval_seconds <= 0:
            logger.info("deadline_reminder sweeper disabled (interval=0)")
            return
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._loop(), name="deadline_reminder_sweeper")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
