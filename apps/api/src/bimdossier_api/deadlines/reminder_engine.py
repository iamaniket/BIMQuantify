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

from bimdossier_api.actions.dispatcher import dispatch_action
from bimdossier_api.background.concurrency import map_bounded
from bimdossier_api.background.periodic import PeriodicSweeper
from bimdossier_api.config import get_settings
from bimdossier_api.db import get_session_maker
from bimdossier_api.deadlines.settings import get_effective_settings
from bimdossier_api.i18n import (
    BILINGUAL_SEPARATOR,
    PLATFORM_DEFAULT_LOCALE,
    resolve_org_locale,
    t,
)
from bimdossier_api.jobs.dispatcher import DispatchJobError
from bimdossier_api.jurisdictions import get_deadline_rules, pick_label
from bimdossier_api.models.deadline import Deadline, DeadlineStatus
from bimdossier_api.models.deadline_notification_log import DeadlineNotificationLog
from bimdossier_api.models.notification import Notification, NotificationEventType
from bimdossier_api.models.organization import Organization, OrganizationStatus
from bimdossier_api.models.project import Project
from bimdossier_api.models.project_member import ProjectMember
from bimdossier_api.models.user import User
from bimdossier_api.notifications.service import (
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


async def _load_members_by_project(
    session: AsyncSession, project_ids: set[UUID]
) -> dict[UUID, list[tuple[User, str]]]:
    """Batch-load every (member, role) for the given projects in ONE query.

    Replaces the per-deadline ``_get_recipients`` query — the N+1 the sweep used
    to run inside its tenant transaction (M-en4). Recipients are then filtered in
    memory per deadline by the effective recipient roles.
    """
    if not project_ids:
        return {}
    stmt = (
        select(ProjectMember.project_id, User, ProjectMember.role)
        .join(ProjectMember, ProjectMember.user_id == User.id)
        .where(ProjectMember.project_id.in_(project_ids))
    )
    by_project: dict[UUID, list[tuple[User, str]]] = {}
    for project_id, user, role in (await session.execute(stmt)).all():
        by_project.setdefault(project_id, []).append((user, role.value))
    return by_project


def _recipients_for(
    members_by_project: dict[UUID, list[tuple[User, str]]],
    project_id: UUID,
    recipient_roles: list[str],
) -> list[User]:
    """In-memory filter of pre-loaded members by role (no DB round-trip)."""
    roles = set(recipient_roles)
    return [user for user, role in members_by_project.get(project_id, []) if role in roles]


async def _sweep_deadline(
    session: AsyncSession,
    deadline: Deadline,
    project: Project,
    today: date,
    members_by_project: dict[UUID, list[tuple[User, str]]],
    *,
    emails: list[dict[str, object]],
    notifs: list[Notification],
) -> None:
    """Stage reminder / missed sends for one deadline (DB phase only).

    Resolves settings, checks the idempotency log, builds the email payloads
    (appended to ``emails``), creates the in-app notification (appended to
    ``notifs`` to publish after commit), and records the send. The email dispatch
    + WS publish happen AFTER the tenant txn closes (M-en4), so the pooled
    connection is never held across that network I/O.
    """
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
            recipients = _recipients_for(members_by_project, project.id, effective.recipient_roles)
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
                # Greet in the project's jurisdiction locale (L10) — the body is
                # bilingual, but the greeting must not be hardcoded English.
                greeting = t("deadlines.email.greeting", project_locale, name=name)
                body = f"{greeting}\n\n{body_en}{BILINGUAL_SEPARATOR}{body_nl}"
                # Stage the email; dispatch happens after the txn closes (M-en4).
                emails.append(
                    {
                        "to": user.email,
                        "subject": subject,
                        "body": body,
                        "action_url": project_url,
                        "action_label": "View project",
                        "type": "reminder",
                    }
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
                notifs.append(notification)
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

        recipients = _recipients_for(members_by_project, project.id, effective.recipient_roles)
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
            # Greet in the project's jurisdiction locale (L10) — see reminder path.
            greeting = t("deadlines.email.greeting", project_locale, name=name)
            body = f"{greeting}\n\n{body_en}{BILINGUAL_SEPARATOR}{body_nl}"
            # Stage the email; dispatch happens after the txn closes (M-en4).
            emails.append(
                {
                    "to": user.email,
                    "subject": subject,
                    "body": body,
                    "action_url": project_url,
                    "action_label": "View project",
                    "type": "alert",
                }
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
            notifs.append(notification)
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
    """Sweep all pending deadlines in one tenant schema. Returns count processed.

    Two phases so the tenant connection is NEVER held across email I/O (M-en4):
      1. A short tenant transaction loads deadlines + projects + members (ONE
         member query, not the old per-deadline N+1), decides what to send,
         creates the in-app notifications, and writes the idempotency log.
      2. With NO connection held, the staged emails are dispatched and the
         notifications published. A dispatch failure is logged, not retried —
         the idempotency log already committed, matching the prior best-effort
         email semantics.
    """
    session_maker = get_session_maker()
    settings = get_settings()
    today = datetime.now(_AMS).date()

    emails: list[dict[str, object]] = []
    notifs: list[Notification] = []
    count = 0

    # --- Phase 1: decide + stage, in a short DB-only transaction. ---
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

        # Pre-load projects + members (one members query — kills the N+1).
        project_ids = {d.project_id for d in deadlines}
        projects_result = await session.execute(select(Project).where(Project.id.in_(project_ids)))
        projects_by_id = {p.id: p for p in projects_result.scalars().all()}
        members_by_project = await _load_members_by_project(session, project_ids)

        for deadline in deadlines:
            project = projects_by_id.get(deadline.project_id)
            if project is None:
                continue
            try:
                await _sweep_deadline(
                    session,
                    deadline,
                    project,
                    today,
                    members_by_project,
                    emails=emails,
                    notifs=notifs,
                )
                count += 1
            except Exception:
                logger.exception(
                    "Error processing deadline %s in schema %s",
                    deadline.id,
                    schema,
                )

    # --- Phase 2: dispatch emails + publish notifications, NO connection held. ---
    for payload in emails:
        try:
            await dispatch_action("send_email", payload, settings, org_id)
        except DispatchJobError:
            logger.exception("Failed to dispatch deadline email for org %s", org_id)

    for notification in notifs:
        await publish_notification(notification, organization_id=org_id)

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
