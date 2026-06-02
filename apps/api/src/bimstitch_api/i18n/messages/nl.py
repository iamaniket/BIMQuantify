"""Dutch message catalog.

Keys must mirror ``en.py`` exactly (same dotted keys, same {placeholders}).
Drift is caught by ``tests/test_i18n_catalog.py``.
"""

from __future__ import annotations

from bimstitch_api.i18n._types import Catalog

nl_messages: Catalog = {
    # ---------- auth ----------
    "auth.activate_email.subject": "Activeer uw BimDossier-account",
    "auth.activate_email.body": (
        "Hoi {name},\n\n"
        "Activeer uw BimDossier-account en stel uw wachtwoord in: {url}\n\n"
        "Token: {token}\n"
    ),
    "auth.reset_password_email.subject": "Wachtwoord opnieuw instellen voor BimDossier",
    "auth.reset_password_email.body": (
        "Verzoek tot wachtwoord-reset voor {email}.\n\n"
        "Resetlink: {url}\n\n"
        "Token: {token}\n"
    ),

    # ---------- invites ----------
    "invites.fallback_inviter.org": "Een BimDossier-beheerder",
    "invites.fallback_inviter.project": "Een BimDossier-teamlid",
    "invites.fallback_inviter.team": "Een teamlid",
    "invites.org_invite.subject": 'Uitnodiging om lid te worden van "{org_name}" op BimDossier',
    "invites.org_invite.body": (
        "Hoi {name},\n\n"
        '{inviter_label} heeft u uitgenodigd om lid te worden van "{org_name}" op BimDossier.\n\n'
        "Log in en ga naar {url} om de uitnodiging te accepteren of af te wijzen.\n"
    ),
    "invites.project_invite.subject": 'Uitnodiging voor project "{project_name}" op BimDossier',
    "invites.project_invite.body": (
        "Hoi {name},\n\n"
        '{inviter_label} heeft u uitgenodigd om mee te werken aan het project '
        '"{project_name}" in "{org_name}" op BimDossier.\n\n'
        "Log in en ga naar {url} om de uitnodiging te accepteren.\n"
    ),
    "invites.project_added.subject": 'U bent toegevoegd aan "{project_name}" op BimDossier',
    "invites.project_added.body": (
        "Hoi {name},\n\n"
        '{inviter_label} heeft u toegevoegd aan het project "{project_name}" op BimDossier.\n\n'
        "Log in om te beginnen met samenwerken.\n"
    ),

    # ---------- deadlines ----------
    "deadlines.reminder_email.subject": "Deadline-herinnering: {deadline_label} — {project_name}",
    "deadlines.reminder_email.body": (
        'Herinnering: de deadline "{deadline_label}" voor project "{project_name}" '
        "vervalt op {due_date} (nog {days_remaining} {days_word}).\n\n"
        "Bekijk het project: {project_url}\n"
    ),
    "deadlines.missed_email.subject": "Gemiste deadline: {deadline_label} — {project_name}",
    "deadlines.missed_email.body": (
        'De deadline "{deadline_label}" voor project "{project_name}" is op '
        "{due_date} verlopen en is niet afgehandeld.\n\nOnderneem zo snel mogelijk actie.\n\n"
        "Bekijk het project: {project_url}\n"
    ),
    "deadlines.reminder_notification.title": "Deadline-herinnering: {deadline_label}",
    "deadlines.reminder_notification.body": (
        'De deadline "{deadline_label}" voor project "{project_name}" '
        "vervalt over {days_remaining} {days_word}."
    ),
    "deadlines.missed_notification.title": "Gemiste deadline: {deadline_label}",
    "deadlines.missed_notification.body": (
        'De deadline "{deadline_label}" voor project "{project_name}" is op '
        "{due_date} verlopen en is niet afgehandeld."
    ),

    # ---------- in-app notifications ----------
    "notifications.finding_assigned.title": "Nieuwe bevinding toegewezen",
    "notifications.finding_assigned.body": "{title}",
    "notifications.finding_resolved.title": "Bevinding opgelost",
    "notifications.finding_resolved.body": "{title}",
    "notifications.org_member_invited.title": "Teamuitnodiging verzonden",
    "notifications.org_member_invited.body": "{invitee_email} is uitgenodigd voor {org_name}",
    "notifications.project_member_invited.title": "Projectuitnodiging verzonden",
    "notifications.project_member_invited.body": "{invitee_email} is uitgenodigd voor {project_name}",
    "notifications.invitation_accepted.title": "Uitnodiging geaccepteerd",
    "notifications.invitation_accepted.body": "{display_name} heeft de uitnodiging voor {org_name} geaccepteerd",

    # ---------- report-pipeline notifications ----------
    "notifications.report.compliance_report.title": "Nalevingsrapport — {name}",
    "notifications.report.compliance_report.body": "Nalevingsrapport wordt gegenereerd…",
    "notifications.report.assurance_plan.title": "Borgingsplan — {name}",
    "notifications.report.assurance_plan.body": "Borgingsplan-PDF wordt gegenereerd…",
    "notifications.report.completion_declaration.title": "Verklaring — {name}",
    "notifications.report.completion_declaration.body": "Verklaring wordt gegenereerd…",
    "notifications.report.dossier.title": "Dossier bevoegd gezag — {name}",
    "notifications.report.dossier.body": "Dossier bevoegd gezag wordt gegenereerd…",

    "notifications.job.running.title": "Rapport wordt gegenereerd",
    "notifications.job.running.body": "{report_title} wordt gegenereerd…",
    "notifications.job.ready.title": "Rapport gereed",
    "notifications.job.ready.body": "{report_title} is gereed om te bekijken",
    "notifications.job.failed.title": "Genereren van rapport mislukt",
    "notifications.job.failed.body": "{report_title}: {error}",
    "notifications.job.unknown_error": "onbekende fout",

    # Dossier-ready email
    "notifications.dossier_ready_email.subject": "Dossier bevoegd gezag gereed",
    "notifications.dossier_ready_email.body": "Het dossier '{title}' staat klaar in BimDossier.",
}
