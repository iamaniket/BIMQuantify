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

import logging
from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.actions.dispatcher import dispatch_action
from bimstitch_api.background.concurrency import map_bounded
from bimstitch_api.background.periodic import PeriodicSweeper
from bimstitch_api.config import get_settings
from bimstitch_api.db import get_session_maker
from bimstitch_api.deadlines.settings import get_effective_settings
from bimstitch_api.i18n import (
    BILINGUAL_SEPARATOR,
    PLATFORM_DEFAULT_LOCALE,
    resolve_org_locale,
    t,
)
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

            project_locale = resolve_org_locale(project.country)
            common_email_vars = {
                "project_name": project.name,
                "due_date": due_str,
                "days_remaining": days_until_due,
                "project_url": project_url,
            }
            body_en = t(
                "deadlines.reminder_email.body",
                "en",
                deadline_label=label_en,
                days_word=days_word_en,
                **common_email_vars,
            )
            body_nl = t(
                "deadlines.reminder_email.body",
                "nl",
                deadline_label=label_nl,
                days_word=days_word_nl,
                **common_email_vars,
            )
            subject_label = label_nl if PLATFORM_DEFAULT_LOCALE == "nl" else label_en
            subject = t(
                "deadlines.reminder_email.subject",
                PLATFORM_DEFAULT_LOCALE,
                deadline_label=subject_label,
                project_name=project.name,
            )

            for user in recipients:
                name = user.full_name or user.email
                body = f"Hi {name},\n\n{body_en}{BILINGUAL_SEPARATOR}{body_nl}"
                try:
                    await dispatch_action(
                        "send_email",
                        {
                            "to": user.email,
                            "subject": subject,
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

            # In-app notification — single-locale per project's jurisdiction.
            notif_label = label_nl if project_locale == "nl" else label_en
            notif_days_word = days_word_nl if project_locale == "nl" else days_word_en
            try:
                notification = await create_notification(
                    session,
                    event_type=NotificationEventType.deadline_upcoming,
                    title=t(
                        "deadlines.reminder_notification.title",
                        project_locale,
                        deadline_label=notif_label,
                    ),
                    body=t(
                        "deadlines.reminder_notification.body",
                        project_locale,
                        deadline_label=notif_label,
                        project_name=project.name,
                        days_remaining=days_until_due,
                        days_word=notif_days_word,
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

        project_locale = resolve_org_locale(project.country)
        common_missed_vars = {
            "project_name": project.name,
            "due_date": due_str,
            "project_url": project_url,
        }
        body_en = t(
            "deadlines.missed_email.body",
            "en",
            deadline_label=label_en,
            **common_missed_vars,
        )
        body_nl = t(
            "deadlines.missed_email.body",
            "nl",
            deadline_label=label_nl,
            **common_missed_vars,
        )
        subject_label = label_nl if PLATFORM_DEFAULT_LOCALE == "nl" else label_en
        subject = t(
            "deadlines.missed_email.subject",
            PLATFORM_DEFAULT_LOCALE,
            deadline_label=subject_label,
            project_name=project.name,
        )

        for user in recipients:
            name = user.full_name or user.email
            body = f"Hi {name},\n\n{body_en}{BILINGUAL_SEPARATOR}{body_nl}"
            try:
                await dispatch_action(
                    "send_email",
                    {
                        "to": user.email,
                        "subject": subject,
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

        # In-app notification — single-locale per project's jurisdiction.
        notif_label = label_nl if project_locale == "nl" else label_en
        try:
            notification = await create_notification(
                session,
                event_type=NotificationEventType.deadline_missed,
                title=t(
                    "deadlines.missed_notification.title",
                    project_locale,
                    deadline_label=notif_label,
                ),
                body=t(
                    "deadlines.missed_notification.body",
                    project_locale,
                    deadline_label=notif_label,
                    project_name=project.name,
                    due_date=deadline.due_date.isoformat(),
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

    async with session_maker() as session:
        result = await session.execute(
            select(Organization.id, Organization.schema_name).where(
                Organization.status == OrganizationStatus.active,
                Organization.deleted_at.is_(None),
            )
        )
        orgs: list[tuple[UUID, str]] = [
            (row.id, row.schema_name) for row in result.all()
        ]

    async def _one(org: tuple[UUID, str]) -> int:
        org_id, schema = org
        try:
            return await _sweep_org(org_id, schema)
        except Exception:
            logger.exception("Deadline sweep failed for org %s", org_id)
            return 0

    counts = await map_bounded(orgs, _one, limit=get_settings().sweep_org_concurrency)
    total = sum(counts)

    if total:
        logger.info("deadline_reminder: processed %d deadlines across %d orgs", total, len(orgs))
    return total


# ---------------------------------------------------------------------------
# Sweeper class (lifespan-managed)
# ---------------------------------------------------------------------------


class DeadlineReminderSweeper(PeriodicSweeper):
    """Runs ``sweep_all_orgs`` on an interval inside the API process. When more
    than one instance runs, only one executes each cycle (advisory lock). Set
    ``interval_minutes=0`` to disable.
    """

    def __init__(self, interval_minutes: int) -> None:
        super().__init__(
            name="deadline_reminder_sweeper",
            interval_seconds=interval_minutes * 60,
            lock_key="sweep:deadline_reminder",
        )

    async def run_once(self) -> None:
        await sweep_all_orgs()
