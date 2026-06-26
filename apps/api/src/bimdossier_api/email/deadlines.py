"""Email templates for deadline reminders and missed-deadline alerts.

Bilingual (NL + EN) plain-text emails — the project can have members in
either locale, and sending one bilingual email per recipient avoids
fanning out per-locale duplicates.

Strings live in the i18n catalog (``bimdossier_api.i18n``). The deadline
label differs per locale ("Bouwmelding" vs "Construction notification"),
so this module composes imperatively: it calls ``t()`` once with the EN
label, once with the NL label, then joins with the bilingual separator.
``t_bilingual()`` doesn't fit here because the same placeholder takes
different values per side.
"""

from __future__ import annotations

from datetime import date

from bimdossier_api.email.transport import get_email_transport
from bimdossier_api.i18n import (
    BILINGUAL_SEPARATOR,
    PLATFORM_DEFAULT_LOCALE,
    t,
)


async def send_deadline_reminder_email(
    *,
    to: str,
    full_name: str | None,
    project_name: str,
    deadline_label_nl: str,
    deadline_label_en: str,
    due_date: date,
    days_remaining: int,
    project_url: str,
) -> None:
    """Upcoming-deadline reminder email (bilingual NL/EN)."""
    due_str = due_date.isoformat()
    common = dict(
        project_name=project_name,
        due_date=due_str,
        days_remaining=days_remaining,
        project_url=project_url,
    )
    body_en = t(
        "deadlines.reminder_email.body",
        "en",
        deadline_label=deadline_label_en,
        days_word="day" if days_remaining == 1 else "days",
        **common,
    )
    body_nl = t(
        "deadlines.reminder_email.body",
        "nl",
        deadline_label=deadline_label_nl,
        days_word="dag" if days_remaining == 1 else "dagen",
        **common,
    )
    name = full_name or to
    body = f"Hi {name},\n\n{body_en}{BILINGUAL_SEPARATOR}{body_nl}"
    subject = t(
        "deadlines.reminder_email.subject",
        PLATFORM_DEFAULT_LOCALE,
        deadline_label=deadline_label_nl if PLATFORM_DEFAULT_LOCALE == "nl" else deadline_label_en,
        project_name=project_name,
    )
    await get_email_transport().send(to=to, subject=subject, body=body)


async def send_deadline_missed_email(
    *,
    to: str,
    full_name: str | None,
    project_name: str,
    deadline_label_nl: str,
    deadline_label_en: str,
    due_date: date,
    project_url: str,
) -> None:
    """Missed-deadline alert email (bilingual NL/EN). Sent once per deadline."""
    due_str = due_date.isoformat()
    common = dict(
        project_name=project_name,
        due_date=due_str,
        project_url=project_url,
    )
    body_en = t(
        "deadlines.missed_email.body",
        "en",
        deadline_label=deadline_label_en,
        **common,
    )
    body_nl = t(
        "deadlines.missed_email.body",
        "nl",
        deadline_label=deadline_label_nl,
        **common,
    )
    name = full_name or to
    body = f"Hi {name},\n\n{body_en}{BILINGUAL_SEPARATOR}{body_nl}"
    subject = t(
        "deadlines.missed_email.subject",
        PLATFORM_DEFAULT_LOCALE,
        deadline_label=deadline_label_nl if PLATFORM_DEFAULT_LOCALE == "nl" else deadline_label_en,
        project_name=project_name,
    )
    await get_email_transport().send(to=to, subject=subject, body=body)
