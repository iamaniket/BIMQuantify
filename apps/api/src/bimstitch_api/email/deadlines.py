"""Email templates for deadline reminders and missed-deadline alerts.

Bilingual (NL + EN) plain-text emails, following the invite email
pattern. Both languages appear in the same email body so the recipient
can read whichever they prefer.
"""

from __future__ import annotations

from datetime import date

from bimstitch_api.email.transport import get_email_transport


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
    name = full_name or to
    due_str = due_date.isoformat()
    days_word_nl = "dag" if days_remaining == 1 else "dagen"
    days_word_en = "day" if days_remaining == 1 else "days"

    body = (
        f"Hi {name},\n\n"
        # English section
        f'Reminder: the deadline "{deadline_label_en}" for project '
        f'"{project_name}" is due on {due_str} '
        f"({days_remaining} {days_word_en} remaining).\n\n"
        f"View the project: {project_url}\n\n"
        f"---\n\n"
        # Dutch section
        f'Herinnering: de deadline "{deadline_label_nl}" voor project '
        f'"{project_name}" vervalt op {due_str} '
        f"(nog {days_remaining} {days_word_nl}).\n\n"
        f"Bekijk het project: {project_url}\n"
    )

    await get_email_transport().send(
        to=to,
        subject=f"Deadline reminder: {deadline_label_en} — {project_name}",
        body=body,
    )


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
    name = full_name or to
    due_str = due_date.isoformat()

    body = (
        f"Hi {name},\n\n"
        # English section
        f'The deadline "{deadline_label_en}" for project '
        f'"{project_name}" was due on {due_str} and has not been met.\n\n'
        f"Please take action as soon as possible.\n\n"
        f"View the project: {project_url}\n\n"
        f"---\n\n"
        # Dutch section
        f'De deadline "{deadline_label_nl}" voor project '
        f'"{project_name}" is op {due_str} verlopen en is niet afgehandeld.\n\n'
        f"Onderneem zo snel mogelijk actie.\n\n"
        f"Bekijk het project: {project_url}\n"
    )

    await get_email_transport().send(
        to=to,
        subject=f"Missed deadline: {deadline_label_en} — {project_name}",
        body=body,
    )
