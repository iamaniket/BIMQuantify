"""English message catalog.

Keys are dotted strings (``"<namespace>.<message>.<part>"``). Every key
here MUST exist in ``nl.py`` with the same placeholder set. Parity is
enforced at runtime by ``tests/test_i18n_catalog.py``.

Placeholder interpolation uses ``str.format`` — ``{name}``, ``{url}``,
etc. Callers pass the same vars regardless of locale.
"""

from __future__ import annotations

from bimstitch_api.i18n._types import Catalog

en_messages: Catalog = {
    # ---------- auth ----------
    # Activation email — sent to a brand-new user created by an admin
    # invite. Locale unknown (User.locale is NULL until they set it),
    # so callers use t_bilingual() for the body. Subject stays
    # single-locale (platform default).
    "auth.activate_email.subject": "Activate your BimDossier account",
    "auth.activate_email.body": (
        "Hi {name},\n\n"
        "Activate your BimDossier account and set your password: {url}\n\n"
        "Token: {token}\n"
    ),
    # Password reset email — recipient is an existing user, so callers
    # resolve their locale.
    "auth.reset_password_email.subject": "Reset your BimDossier password",
    "auth.reset_password_email.body": (
        "Password reset requested for {email}.\n\n"
        "Reset link: {url}\n\n"
        "Token: {token}\n"
    ),

    # ---------- invites ----------
    # Sent to ALREADY-VERIFIED existing users. Locale comes from
    # User.locale; activation does not run for these recipients.
    # Fallback inviter labels used when the inviter's email isn't captured.
    "invites.fallback_inviter.org": "A BimDossier admin",
    "invites.fallback_inviter.project": "A BimDossier team member",
    "invites.fallback_inviter.team": "A team member",
    "invites.org_invite.subject": 'Invitation to join "{org_name}" on BimDossier',
    "invites.org_invite.body": (
        "Hi {name},\n\n"
        '{inviter_label} has invited you to join "{org_name}" on BimDossier.\n\n'
        "Sign in and visit {url} to accept or decline the invitation.\n"
    ),
    "invites.project_invite.subject": 'Invitation to project "{project_name}" on BimDossier',
    "invites.project_invite.body": (
        "Hi {name},\n\n"
        '{inviter_label} has invited you to collaborate on the project '
        '"{project_name}" in "{org_name}" on BimDossier.\n\n'
        "Sign in and visit {url} to accept the invitation.\n"
    ),
    "invites.project_added.subject": 'You\'ve been added to "{project_name}" on BimDossier',
    "invites.project_added.body": (
        "Hi {name},\n\n"
        '{inviter_label} has added you to the project "{project_name}" on BimDossier.\n\n'
        "Sign in to start collaborating.\n"
    ),

    # ---------- deadlines ----------
    # Bilingual emails (one bilingual body per recipient) — the project's
    # members can span locales, and the existing convention is one email
    # showing both. Subjects stay single-locale at platform default.
    # `deadline_label` is locale-specific — callers pass label_en for the
    # 'en' lookup and label_nl for the 'nl' lookup (the catalog template
    # uses one placeholder per side).
    "deadlines.reminder_email.subject": "Deadline reminder: {deadline_label} — {project_name}",
    "deadlines.reminder_email.body": (
        'Reminder: the deadline "{deadline_label}" for project "{project_name}" '
        "is due on {due_date} ({days_remaining} {days_word} remaining).\n\n"
        "View the project: {project_url}\n"
    ),
    "deadlines.missed_email.subject": "Missed deadline: {deadline_label} — {project_name}",
    "deadlines.missed_email.body": (
        'The deadline "{deadline_label}" for project "{project_name}" was due on '
        "{due_date} and has not been met.\n\nPlease take action as soon as possible.\n\n"
        "View the project: {project_url}\n"
    ),
    # In-app notifications (single-locale: project's jurisdiction default).
    "deadlines.reminder_notification.title": "Deadline reminder: {deadline_label}",
    "deadlines.reminder_notification.body": (
        'The deadline "{deadline_label}" for project "{project_name}" '
        "is due in {days_remaining} {days_word}."
    ),
    "deadlines.missed_notification.title": "Missed deadline: {deadline_label}",
    "deadlines.missed_notification.body": (
        'The deadline "{deadline_label}" for project "{project_name}" was due on '
        "{due_date} and has not been met."
    ),

    # ---------- in-app notifications ----------
    "notifications.finding_assigned.title": "New finding assigned",
    "notifications.finding_assigned.body": "{title}",
    "notifications.finding_resolved.title": "Finding resolved",
    "notifications.finding_resolved.body": "{title}",
    "notifications.org_member_invited.title": "Team invitation sent",
    "notifications.org_member_invited.body": "{invitee_email} has been invited to {org_name}",
    "notifications.project_member_invited.title": "Project invitation sent",
    "notifications.project_member_invited.body": "{invitee_email} has been invited to {project_name}",
    "notifications.invitation_accepted.title": "Invitation accepted",
    "notifications.invitation_accepted.body": "{display_name} accepted the invitation to {org_name}",

    # ---------- report-pipeline notifications ----------
    # Absorbed from routers/reports.py::_REPORT_TITLE_TEMPLATES and
    # _REPORT_NOTIFICATION_BODY. The {name} placeholder is the project
    # name.
    "notifications.report.compliance_report.title": "Compliance report — {name}",
    "notifications.report.compliance_report.body": "Compliance report is being generated…",
    "notifications.report.assurance_plan.title": "Assurance plan — {name}",
    "notifications.report.assurance_plan.body": "Assurance plan PDF is being generated…",
    "notifications.report.completion_declaration.title": "Completion declaration — {name}",
    "notifications.report.completion_declaration.body": "Completion declaration is being generated…",
    "notifications.report.dossier.title": "Dossier for the competent authority — {name}",
    "notifications.report.dossier.body": "Dossier for the competent authority is being generated…",

    # Job-status notifications (report pipeline). Absorbed from
    # routers/jobs_internal.py inline title/body maps.
    "notifications.job.running.title": "Report is being generated",
    "notifications.job.running.body": "{report_title} is being generated…",
    "notifications.job.ready.title": "Report ready",
    "notifications.job.ready.body": "{report_title} is ready to view",
    "notifications.job.failed.title": "Report generation failed",
    "notifications.job.failed.body": "{report_title}: {error}",
    "notifications.job.unknown_error": "unknown error",

    # Dossier-ready email — single-locale via report.locale. Absorbed
    # from routers/jobs_internal.py:486-495.
    "notifications.dossier_ready_email.subject": "Dossier for the authority is ready",
    "notifications.dossier_ready_email.body": "The dossier '{title}' is ready in BimDossier.",
}
