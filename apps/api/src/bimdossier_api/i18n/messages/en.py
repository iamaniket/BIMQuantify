"""English message catalog.

Keys are dotted strings (``"<namespace>.<message>.<part>"``). Every key
here MUST exist in ``nl.py`` with the same placeholder set. Parity is
enforced at runtime by ``tests/test_i18n_catalog.py``.

Placeholder interpolation uses ``str.format`` — ``{name}``, ``{url}``,
etc. Callers pass the same vars regardless of locale.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bimdossier_api.i18n._types import Catalog

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
    "notifications.report.snag_list.title": "Snag list — {name}",
    "notifications.report.snag_list.body": "Snag-list PDF is being generated…",

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

    # ============================================================
    # HTTP error messages — errors.<CODE>
    # ------------------------------------------------------------
    # One entry per SCREAMING_SNAKE code raised via HTTPException across the
    # API. The handlers in i18n/http_errors.py look these up as `errors.<CODE>`
    # (the code before any ":context" suffix). Messages are user-facing,
    # concise, and static (no {placeholders}) in v1. Every key MUST also exist
    # in nl.py — test_i18n_catalog.py enforces parity; test_error_catalog.py
    # enforces that every raised code has an entry here.

    # --- generic fallbacks ---
    "errors.ERROR": "Something went wrong. Please try again.",
    "errors.INTERNAL_ERROR": "Something went wrong on our end. Please try again later.",
    "errors.VALIDATION_ERROR": "Some of the submitted data is invalid. Please check your input and try again.",
    "errors.INVALID_SORT_KEY": "That column can't be sorted.",
    "errors.IDEMPOTENCY_KEY_INVALID": "The Idempotency-Key header is malformed.",
    "errors.IDEMPOTENCY_KEY_CONFLICT": "This request is already being processed. Please try again in a moment.",

    # --- auth / session ---
    "errors.UNAUTHORIZED": "You need to sign in to continue.",
    "errors.LOGIN_BAD_CREDENTIALS": "Invalid email or password.",
    "errors.LOGIN_USER_NOT_VERIFIED": "Please verify your email address before signing in.",
    "errors.ACTIVATION_BAD_TOKEN": "This activation link is invalid or has expired.",
    "errors.ACTIVATION_INVALID_PASSWORD": "That password doesn't meet the requirements.",
    "errors.ACTIVATION_USER_INACTIVE": "This account is not active. Please contact an administrator.",
    "errors.REFRESH_TOKEN_REVOKED": "Your session has expired. Please sign in again.",
    "errors.USER_NO_LONGER_ACTIVE": "This account is no longer active.",
    "errors.LOGOUT_REVOCATION_UNAVAILABLE": "We couldn't complete sign-out. Please try again.",
    "errors.IMPERSONATION_REFRESH_FORBIDDEN": "Impersonation sessions can't be refreshed.",

    # --- authorization / roles ---
    "errors.PERMISSION_DENIED": "You don't have permission to perform this action.",
    "errors.SUPERUSER_REQUIRED": "This action requires super-admin privileges.",
    "errors.ORG_ADMIN_REQUIRED": "This action requires workspace-admin privileges.",
    "errors.ORG_MEMBERSHIP_REQUIRED": "You must be a member of this workspace to continue.",
    "errors.INSUFFICIENT_PROJECT_ROLE": "Your role on this project doesn't allow this action.",
    "errors.NOT_ORG_MEMBER": "You're not a member of this workspace.",
    "errors.SELF_ACTION_FORBIDDEN": "You can't perform this action on your own account.",
    "errors.UNSUPPORTED_COUNTRY": "That country isn't a supported jurisdiction.",
    "errors.INVALID_PROJECT_ROLE": "That project role isn't valid.",
    "errors.TARGET_NOT_IN_ORG": "That user isn't a member of this workspace.",
    "errors.USER_NOT_IN_PROJECT_ORG": "That user isn't a member of the project's workspace.",
    "errors.GUEST_CANNOT_CREATE_PROJECT": "Guests can't create projects.",
    "errors.GUEST_CANNOT_BE_OWNER": "Guests can't be made project owner.",
    "errors.GUEST_CANNOT_BE_ORG_ADMIN": "Guests can't be made workspace admins.",
    "errors.GUEST_REQUIRES_PROJECTS": "Assign at least one project when inviting a guest.",

    # --- impersonation (super-admin) ---
    "errors.CANNOT_IMPERSONATE_SELF": "You can't impersonate yourself.",
    "errors.CANNOT_IMPERSONATE_SUPERUSER": "You can't impersonate another super-admin.",
    "errors.CANNOT_IMPERSONATE_INACTIVE": "You can't impersonate an inactive user.",
    "errors.CANNOT_IMPERSONATE_UNVERIFIED": "You can't impersonate an unverified user.",
    "errors.NOT_AN_IMPERSONATION_SESSION": "This isn't an impersonation session, so there's nothing to stop.",
    "errors.IMPERSONATION_STOP_UNAVAILABLE": "We couldn't end the impersonation session. Please try again.",

    # --- users / members ---
    "errors.USER_NOT_FOUND": "That user could not be found.",
    "errors.MEMBER_NOT_FOUND": "That member could not be found.",
    "errors.MEMBER_NOT_PENDING": "That member's invitation is no longer pending.",
    "errors.MEMBER_ALREADY_EXISTS": "That user is already a member.",
    "errors.ORG_MEMBER_ALREADY_EXISTS": "That user is already a member of this workspace.",
    "errors.CANNOT_DEACTIVATE_SELF": "You can't deactivate your own account.",
    "errors.LAST_ADMIN_REQUIRED": "You can't remove the last administrator.",
    "errors.LAST_SUPERUSER_REQUIRED": "You can't remove the last super-admin.",
    "errors.OWNER_NOT_REMOVABLE": "The project owner can't be removed.",
    "errors.OWNER_ROLE_NOT_ASSIGNABLE": "The owner role can't be assigned this way.",
    "errors.OWNER_ROLE_NOT_CHANGEABLE": "The owner's role can't be changed.",
    "errors.OWNS_ACTIVE_PROJECTS": "This user still owns active projects. Reassign them first.",
    "errors.DEMOTE_ADMIN_BEFORE_GUEST": "Remove this member's admin rights before making them a guest.",
    "errors.REASSIGN_TARGET_NOT_ELIGIBLE": "That user can't receive these projects.",
    "errors.ASSIGNEE_NOT_A_PROJECT_MEMBER": "The assignee must be a member of this project.",
    "errors.INVALID_FINDING_FILTER": "One of the report filters is not valid.",

    # --- invitations / access requests ---
    "errors.INVITATION_NOT_FOUND": "That invitation could not be found.",
    "errors.INVITATION_EXPIRED": "This invitation has expired.",
    "errors.ORG_INVITE_ALREADY_PENDING": "An invitation for this user is already pending.",
    "errors.ALREADY_REVOKED": "This has already been revoked.",
    "errors.ACCESS_REQUEST_NOT_FOUND": "That access request could not be found.",
    "errors.ACCESS_REQUEST_NOT_PENDING": "That access request is no longer pending.",

    # --- organizations ---
    "errors.ORG_NOT_FOUND": "That workspace could not be found.",
    "errors.ORG_NOT_AVAILABLE": "This workspace is currently unavailable.",
    "errors.ORG_NOT_ACTIVE": "This workspace is not active.",
    "errors.ORG_SUSPENDED": "This workspace is suspended. Please contact a super-admin to restore access.",
    "errors.ORG_NAME_TAKEN": "That workspace name is already taken.",
    "errors.ORG_STATUS_NOT_TRANSITIONABLE": "This workspace's status can't be changed that way.",
    "errors.NO_ACTIVE_ORGANIZATION": "Select a workspace before continuing.",
    "errors.SEAT_LIMIT_EXCEEDED": "Seat limit reached. Raise the limit or remove a member before inviting.",
    "errors.SEAT_LIMIT_BELOW_USAGE": "The new seat limit is below the number of seats currently in use.",
    "errors.STORAGE_LIMIT_BELOW_USAGE": "The new storage limit is below the amount currently in use.",
    "errors.PROVISIONING_FAILED": "We couldn't finish setting up the workspace. Please try again.",

    # --- projects ---
    "errors.PROJECT_NOT_FOUND": "That project could not be found.",
    "errors.PROJECT_NAME_CONFLICT": "A project with that name already exists.",
    "errors.PROJECT_ARCHIVED": "This project is archived. Reactivate it to make changes.",
    "errors.PROJECT_NOT_ARCHIVED": "This project isn't archived.",
    "errors.NAME_EMPTY_AFTER_TRIM": "The name can't be empty.",
    "errors.CONSEQUENCE_CLASS_OUT_OF_SCOPE": "That consequence class isn't valid for the selected country.",
    "errors.INSTRUMENT_NOT_REGISTERED": "That instrument isn't available for the selected country.",

    # --- documents / versions ---
    "errors.DOCUMENT_NOT_FOUND": "That document could not be found.",
    "errors.DOCUMENT_NAME_CONFLICT": "A document with that name already exists.",
    "errors.DOCUMENT_FILE_TYPE_LOCKED": "This document's file type can no longer be changed.",
    "errors.DOCUMENT_LEVEL_NOT_FOR_IFC": "A 3D model can't be assigned to a level; levels are for 2D drawings.",
    "errors.LEVEL_NOT_FOUND": "That level could not be found.",
    "errors.LEVEL_NAME_CONFLICT": "A level with that name already exists.",
    "errors.VERSION_NUMBER_CONFLICT": "That version number is already in use.",
    "errors.SOURCE_NOT_RESTORABLE": "Only a ready, fully-processed version can be restored.",
    "errors.VERSION_ALREADY_HEAD": "That version is already the current one.",

    # --- storeys / aligned sheets (PDF<->3D alignment) ---
    "errors.STOREY_NOT_FOUND": "That storey could not be found.",
    "errors.ALIGNED_SHEET_NOT_FOUND": "That aligned drawing could not be found.",
    "errors.ALIGNED_SHEET_PDF_DOCUMENT_INVALID": "Choose a PDF document to align.",
    "errors.ALIGNED_SHEET_STOREY_DOCUMENT_MISMATCH": "That storey doesn't belong to the selected document.",
    "errors.ALIGNED_SHEET_DEGENERATE_POINTS": "Pick two distinct points on each side to align the drawing.",
    "errors.ALIGNED_SHEET_DUPLICATE": "This drawing page is already aligned to that floor.",

    # --- files / uploads / storage ---
    "errors.FILE_NOT_FOUND": "That file could not be found.",
    "errors.PROJECT_FILE_NOT_FOUND": "That project file could not be found.",
    "errors.FILE_NOT_READY": "This file isn't ready yet.",
    "errors.FILE_ALREADY_FINALIZED": "This file has already been finalized.",
    "errors.FILE_TOO_LARGE": "This file is too large.",
    "errors.INVALID_FILE_EXTENSION": "That file type isn't supported.",
    "errors.DUPLICATE_FILE_CONTENT": "This file is identical to one that's already been uploaded.",
    "errors.DUPLICATE_CONTENT": "This content is identical to something already uploaded.",
    "errors.OBJECT_NOT_UPLOADED": "The file wasn't uploaded. Please try again.",
    "errors.MISSING_STORAGE_KEY": "This item has no stored file.",
    "errors.SIZE_MISMATCH": "The uploaded file size doesn't match what was expected.",
    "errors.INVALID_ASSET_KEY": "That asset reference is invalid.",

    # --- extraction / viewer ---
    "errors.EXTRACTION_NOT_COMPLETE": "Document extraction hasn't finished yet.",
    "errors.EXTRACTION_NOT_FAILED": "This extraction hasn't failed, so it can't be retried.",
    "errors.VIEWER_BUNDLE_NOT_READY": "The 3D viewer data isn't ready yet.",

    # --- avatars / images / thumbnails ---
    "errors.NO_AVATAR": "There's no avatar to remove.",
    "errors.AVATAR_INVALID_TYPE": "That image type isn't supported for avatars.",
    "errors.AVATAR_TOO_LARGE": "That avatar image is too large.",
    "errors.ORG_IMAGE_INVALID_TYPE": "That image type isn't supported.",
    "errors.ORG_IMAGE_TOO_LARGE": "That image is too large.",
    "errors.THUMBNAIL_UNSUPPORTED_TYPE": "That thumbnail image type isn't supported.",
    "errors.THUMBNAIL_TOO_LARGE": "That thumbnail image is too large.",

    # --- findings ---
    "errors.FINDING_NOT_FOUND": "That finding could not be found.",
    "errors.FINDING_ILLEGAL_TRANSITION": "That status change isn't allowed for this finding.",
    "errors.FINDING_RESOLVE_REQUIRES_EVIDENCE": "Add evidence before resolving this finding.",
    "errors.FINDING_VERIFY_REQUIRES_INSPECTOR": "Only an inspector can verify this finding.",
    "errors.FINDING_PROMOTE_REQUIRES_DEADLINE_ASSIGNEE": "Set a deadline and an assignee before promoting this finding.",
    "errors.FINDING_TEMPLATE_NOT_FOUND": "That finding template no longer exists.",
    "errors.FINDING_TEMPLATE_REQUIRED_FIELD": "Please fill in all required fields.",

    # --- custom finding fields ---
    "errors.CUSTOM_FIELD_REQUIRED": "Please fill in all required fields.",
    "errors.CUSTOM_FIELD_BAD_TEXT": "One of the text fields has an invalid value.",
    "errors.CUSTOM_FIELD_TOO_LONG": "One of the fields is too long.",
    "errors.CUSTOM_FIELD_NOT_A_NUMBER": "One of the fields must be a number.",
    "errors.CUSTOM_FIELD_NUMBER_OUT_OF_RANGE": "One of the numeric fields is out of range.",
    "errors.CUSTOM_FIELD_BAD_DATE": "One of the date fields is invalid.",
    "errors.CUSTOM_FIELD_BAD_OPTION": "One of the fields has an option that isn't allowed.",
    "errors.CUSTOM_FIELD_UNKNOWN_TYPE": "One of the fields has an unsupported type.",
    "errors.CUSTOM_VALUES_WITHOUT_TEMPLATE": "This finding has no template, so custom fields can't be set.",
    "errors.UNKNOWN_CUSTOM_FIELD": "This finding contains a field that isn't on its template.",

    # --- templates (finding forms / report layouts) ---
    "errors.ORG_TEMPLATE_NOT_FOUND": "That template could not be found.",
    "errors.REPORT_TEMPLATE_NOT_FOUND": "That report template could not be found.",
    "errors.CANNOT_DELETE_DEFAULT_TEMPLATE": "You can't delete the default template. Set another as the default first.",
    "errors.DEFAULT_TEMPLATE_CONFLICT": "Another template was just set as the default. Please try again.",
    "errors.TEMPLATE_TYPE_MISMATCH": "That template is the wrong type for this action.",
    "errors.SCHEMA_NOT_AVAILABLE_FOR_TYPE": "No schema is available for this template type.",
    "errors.INVALID_CONFIG": "The template configuration is invalid.",
    "errors.UNKNOWN_SECTION_KEY": "The template refers to a section that doesn't exist.",
    "errors.UNKNOWN_BUILTIN_FIELD": "The template refers to a field that doesn't exist.",
    "errors.DUPLICATE_FIELD_ID": "Two fields share the same id.",
    "errors.DUPLICATE_FIELD_LABEL": "Two fields share the same label.",
    "errors.DUPLICATE_SECTION_KEY": "Two sections share the same key.",
    "errors.DUPLICATE_TEXT_BLOCK_ID": "Two text blocks share the same id.",
    "errors.TOO_MANY_FIELDS": "This template has too many fields.",
    "errors.MIN_GREATER_THAN_MAX": "The minimum can't be greater than the maximum.",
    "errors.MINMAX_ONLY_FOR_NUMBER": "Minimum and maximum only apply to number fields.",
    "errors.OPTIONS_ONLY_FOR_SELECT": "Options only apply to selection fields.",
    "errors.SELECT_FIELD_NEEDS_OPTIONS": "A selection field needs at least one option.",
    "errors.SELECT_OPTION_EMPTY": "Selection options can't be empty.",
    "errors.SELECT_OPTIONS_NOT_UNIQUE": "Selection options must be unique.",

    # --- assurance plan / moments / checklist ---
    "errors.BORGINGSPLAN_NOT_FOUND": "That assurance plan could not be found.",
    "errors.BORGINGSMOMENT_NOT_FOUND": "That assurance moment could not be found.",
    "errors.CHECKLIST_ITEM_NOT_FOUND": "That checklist item could not be found.",
    "errors.NO_ACTIVE_PLAN": "This project has no active assurance plan.",
    "errors.NO_ASSURANCE_PLAN": "This project has no assurance plan.",
    "errors.PLAN_NOT_EDITABLE": "This assurance plan can no longer be edited.",
    "errors.PLAN_ALREADY_PUBLISHED": "This assurance plan has already been published.",
    "errors.PLAN_NOT_PUBLISHED": "This assurance plan hasn't been published yet.",
    "errors.PUBLISHED_PLAN_EXISTS": "A published assurance plan already exists.",
    "errors.PLAN_GENERATION_RACE": "The plan was just changed elsewhere. Please refresh and try again.",
    "errors.MOMENT_ALREADY_COMPLETED": "This moment has already been completed.",
    "errors.MOMENT_NOT_IN_PROGRESS": "This moment isn't in progress.",
    "errors.REORDER_ITEM_IDS_MISMATCH": "The reordered items don't match the current list. Please refresh.",
    "errors.REORDER_MOMENT_IDS_MISMATCH": "The reordered moments don't match the current list. Please refresh.",
    "errors.NVT_REQUIRES_NOTE": "Add a note to mark this as not applicable.",
    "errors.INCOMPLETE_INSPECTION": "Complete the inspection before continuing.",

    # --- deadlines ---
    "errors.DEADLINE_NOT_FOUND": "That deadline could not be found.",
    "errors.DEADLINE_NOT_APPLICABLE": "That deadline doesn't apply here.",
    "errors.UNKNOWN_DEADLINE_TYPE": "That deadline type isn't recognized.",

    # --- risks ---
    "errors.RISK_NOT_FOUND": "That risk could not be found.",

    # --- compliance / reports ---
    "errors.MISSING_ARTIFACTS": "The required files for this check are missing.",
    "errors.NO_COMPLIANCE_DATA": "There's no compliance data for this project yet.",
    "errors.NO_COMPLIANCE_RESULTS": "No compliance results are available yet.",
    "errors.COMPLIANCE_CHECK_FAILED": "The compliance check couldn't be completed. Please try again.",
    "errors.FRAMEWORK_NOT_REGISTERED": "That regulatory framework isn't available for this project.",
    "errors.REPORT_NOT_FOUND": "That report could not be found.",
    "errors.REPORT_NOT_READY": "This report isn't ready yet.",
    "errors.REPORT_ALREADY_SIGNED": "This report has already been signed.",
    "errors.REPORT_TYPE_NOT_AVAILABLE": "That report type isn't available for this project.",
    "errors.NOT_A_DECLARATION": "This report isn't a declaration.",

    # --- jobs ---
    "errors.JOB_NOT_FOUND": "That job could not be found.",
    "errors.JOB_NOT_FAILED": "This job hasn't failed, so it can't be retried.",
    "errors.JOB_NOT_RETRIABLE": "This job can't be retried.",
    "errors.JOB_TYPE_NOT_RETRYABLE": "This type of job can't be retried.",
    "errors.JOB_ALREADY_RUNNING": "This job is already running.",
    "errors.JOB_NOT_CANCELLABLE": "This job can't be cancelled.",
    "errors.CANCEL_DISPATCH_FAILED": "We couldn't cancel the job. Please try again.",
    "errors.TOO_MANY_ACTIVE_JOBS": "Too many jobs are already running. Please wait for one to finish.",
    "errors.INVALID_CALLBACK_STATUS": "The job reported an unexpected status.",

    # --- attachments / certificates ---
    "errors.ATTACHMENT_NOT_FOUND": "That attachment could not be found.",
    "errors.ATTACHMENT_NOT_PENDING": "That attachment is no longer awaiting upload.",
    "errors.ATTACHMENT_NOT_READY": "That attachment isn't ready yet.",
    "errors.CERTIFICATE_NOT_FOUND": "That certificate could not be found.",
    "errors.CERTIFICATE_NOT_PENDING": "That certificate is no longer awaiting upload.",
    "errors.CERTIFICATE_NOT_READY": "That certificate isn't ready yet.",
    "errors.ORG_CERTIFICATE_NOT_FOUND": "That certificate could not be found.",
    "errors.ORG_CERTIFICATE_NOT_PENDING": "That certificate is no longer awaiting upload.",
    "errors.ORG_CERTIFICATE_NOT_READY": "That certificate isn't ready yet.",

    # --- BCF ---
    "errors.BCF_TOPIC_NOT_FOUND": "That BCF topic could not be found.",
    "errors.BCF_COMMENT_NOT_FOUND": "That BCF comment could not be found.",
    "errors.BCF_VIEWPOINT_NOT_FOUND": "That BCF viewpoint could not be found.",
    "errors.INVALID_BCF_ARCHIVE": "That BCF file is invalid or corrupted.",

    # --- capture links ---
    "errors.CAPTURE_LINK_NOT_FOUND": "That capture link could not be found.",
    "errors.CAPTURE_LINK_EXPIRED": "This capture link has expired.",
    "errors.CAPTURE_LINK_REVOKED": "This capture link has been revoked.",
    "errors.CAPTURE_LINK_EXHAUSTED": "This capture link has reached its usage limit.",
    "errors.INVALID_CAPTURE_LINK": "This capture link is invalid.",

    # --- status transitions ---
    "errors.INVALID_STATUS_TRANSITION": "That status change isn't allowed.",

    # --- notifications ---
    "errors.NOTIFICATION_NOT_FOUND": "That notification could not be found.",

    # --- blog (admin) ---
    "errors.BLOG_POST_NOT_FOUND": "That blog post could not be found.",
    "errors.BLOG_TITLE_EMPTY": "The title can't be empty.",
    "errors.BLOG_DESCRIPTION_EMPTY": "The description can't be empty.",
    "errors.BLOG_CONTENT_EMPTY": "The content can't be empty.",
    "errors.BLOG_CONTENT_TOO_LARGE": "The content is too large.",
    "errors.BLOG_SLUG_INVALID": "That slug is invalid.",
    "errors.BLOG_SLUG_TAKEN": "That slug is already in use.",
    "errors.BLOG_STATUS_INVALID": "That status is invalid.",
    "errors.BLOG_LOCALE_INVALID": "That language is invalid.",
    "errors.BLOG_TAGS_INVALID": "One or more tags are invalid.",
    "errors.BLOG_PUBLISHED_AT_INVALID": "That publish date is invalid.",
    "errors.BLOG_IMAGE_EMPTY": "No image was provided.",
    "errors.BLOG_IMAGE_INVALID_TYPE": "That image type isn't supported.",
    "errors.BLOG_IMAGE_TOO_LARGE": "That image is too large.",
    "errors.BLOG_STORAGE_FAILED": "We couldn't store the image. Please try again.",

    # ============================================================
    # Success messages — messages.<CODE>
    # ------------------------------------------------------------
    # Attached to 2xx responses via attach_notice() as the X-Message header.
    # Same parity rule: every key must exist in both locales.
    "messages.PROJECT_CREATED": "Project created.",
    "messages.PROJECT_UPDATED": "Project updated.",
    "messages.PROJECT_ARCHIVED": "Project archived.",
    "messages.PROJECT_REACTIVATED": "Project reactivated.",
    "messages.CHANGES_SAVED": "Changes saved.",
    "messages.MEMBER_INVITED": "Invitation sent.",
    "messages.TEMPLATE_SAVED": "Template saved.",
    "messages.TEMPLATE_DELETED": "Template deleted.",
}
