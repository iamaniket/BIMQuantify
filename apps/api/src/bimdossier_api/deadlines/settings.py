"""Settings resolution for deadline notification preferences.

Resolution order (most specific wins):

1. **Project override** — ``project_id IS NOT NULL`` row in
   ``deadline_notification_settings`` for the given project + type.
2. **Org default** — ``project_id IS NULL`` row for the type.
3. **Jurisdiction default** — ``DeadlineRule.default_reminder_days`` /
   ``default_recipient_roles`` from the jurisdiction registry.

This means a freshly provisioned org works out of the box with zero seed
data. Rows are only created when someone customises via the API.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.jurisdictions import (
    get_deadline_rules,
    pick_label,
)
from bimdossier_api.models.deadline_notification_settings import (
    DeadlineNotificationSettings,
)
from bimdossier_api.schemas.deadline_notification_settings import (
    EffectiveDeadlineNotificationSettings,
)


async def get_effective_settings(
    session: AsyncSession,
    project_id: UUID | None,
    deadline_type: str,
    country: str,
    locale: str = "en",
) -> EffectiveDeadlineNotificationSettings | None:
    """Resolve the effective notification settings for a single deadline type.

    Returns ``None`` if *deadline_type* is not defined by the jurisdiction.
    """
    rules = get_deadline_rules(country)
    rule = next((r for r in rules if r.deadline_type == deadline_type), None)
    if rule is None:
        return None

    # Start from jurisdiction defaults.
    reminder_days = list(rule.default_reminder_days)
    recipient_roles = list(rule.default_recipient_roles)
    enabled = True
    source = "jurisdiction_default"

    # Check org-level default (project_id IS NULL).
    org_default = (
        await session.execute(
            select(DeadlineNotificationSettings).where(
                DeadlineNotificationSettings.project_id.is_(None),
                DeadlineNotificationSettings.deadline_type == deadline_type,
            )
        )
    ).scalar_one_or_none()

    if org_default is not None:
        reminder_days = list(org_default.reminder_days)
        recipient_roles = list(org_default.recipient_roles)
        enabled = org_default.enabled
        source = "org_default"

    # Check project-level override (if a project is specified).
    if project_id is not None:
        project_override = (
            await session.execute(
                select(DeadlineNotificationSettings).where(
                    DeadlineNotificationSettings.project_id == project_id,
                    DeadlineNotificationSettings.deadline_type == deadline_type,
                )
            )
        ).scalar_one_or_none()

        if project_override is not None:
            reminder_days = list(project_override.reminder_days)
            recipient_roles = list(project_override.recipient_roles)
            enabled = project_override.enabled
            source = "project_override"

    return EffectiveDeadlineNotificationSettings(
        deadline_type=deadline_type,
        label=pick_label(rule.label, locale, "en"),
        reminder_days=reminder_days,
        recipient_roles=recipient_roles,
        enabled=enabled,
        source=source,
        legal_reference=rule.legal_reference,
    )


async def get_all_effective_settings(
    session: AsyncSession,
    project_id: UUID | None,
    country: str,
    locale: str = "en",
) -> list[EffectiveDeadlineNotificationSettings]:
    """Resolve effective settings for ALL deadline types in a jurisdiction."""
    rules = get_deadline_rules(country)
    results: list[EffectiveDeadlineNotificationSettings] = []
    for rule in rules:
        effective = await get_effective_settings(
            session, project_id, rule.deadline_type, country, locale
        )
        if effective is not None:
            results.append(effective)
    return results
