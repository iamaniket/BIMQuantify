"""Dutch message catalog.

Keys must mirror ``en.py`` exactly (same dotted keys, same {placeholders}).
Drift is caught by ``tests/test_i18n_catalog.py``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bimdossier_api.i18n._types import Catalog

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
    "notifications.report.snag_list.title": "Bevindingenlijst — {name}",
    "notifications.report.snag_list.body": "Bevindingenlijst-PDF wordt gegenereerd…",

    "notifications.job.running.title": "Rapport wordt gegenereerd",
    "notifications.job.running.body": "{report_title} wordt gegenereerd…",
    "notifications.job.ready.title": "Rapport gereed",
    "notifications.job.ready.body": "{report_title} is gereed om te bekijken",
    "notifications.job.failed.title": "Genereren van rapport mislukt",
    "notifications.job.failed.body": "{report_title}: {error}",
    "notifications.job.unknown_error": "onbekende fout",

    # Extractie-notificaties (IFC/PDF). Gelokaliseerd naar de jurisdictie van het
    # project in routers/jobs_internal.py::_emit_notification (geen enkele ontvanger).
    "notifications.extraction.started.title": "Extractie gestart",
    "notifications.extraction.started.body": "Extractie van {filename} is bezig",
    "notifications.extraction.completed.title": "Extractie voltooid",
    "notifications.extraction.completed.body": "{filename} is gereed om te bekijken",
    "notifications.extraction.failed.title": "Extractie mislukt",
    "notifications.extraction.failed.body": "Extractie van {filename} mislukt: {error}",
    "notifications.extraction.unknown_error": "onbekende fout",

    # Dossier-ready email
    "notifications.dossier_ready_email.subject": "Dossier bevoegd gezag gereed",
    "notifications.dossier_ready_email.body": "Het dossier '{title}' staat klaar in BimDossier.",

    # ============================================================
    # HTTP-foutmeldingen — errors.<CODE>  (mirror van en.py)
    # ============================================================

    # --- generiek ---
    "errors.ERROR": "Er is iets misgegaan. Probeer het opnieuw.",
    "errors.INTERNAL_ERROR": "Er is aan onze kant iets misgegaan. Probeer het later opnieuw.",
    "errors.VALIDATION_ERROR": "Een deel van de ingevoerde gegevens is ongeldig. Controleer uw invoer en probeer het opnieuw.",
    "errors.INVALID_SORT_KEY": "Op die kolom kan niet worden gesorteerd.",
    "errors.IDEMPOTENCY_KEY_INVALID": "De Idempotency-Key-header is ongeldig.",
    "errors.IDEMPOTENCY_KEY_CONFLICT": "Dit verzoek wordt al verwerkt. Probeer het zo opnieuw.",

    # --- authenticatie / sessie ---
    "errors.UNAUTHORIZED": "U moet inloggen om door te gaan.",
    "errors.LOGIN_BAD_CREDENTIALS": "Ongeldig e-mailadres of wachtwoord.",
    "errors.LOGIN_USER_NOT_VERIFIED": "Bevestig eerst uw e-mailadres voordat u inlogt.",
    "errors.ACTIVATION_BAD_TOKEN": "Deze activatielink is ongeldig of verlopen.",
    "errors.ACTIVATION_INVALID_PASSWORD": "Dat wachtwoord voldoet niet aan de eisen.",
    "errors.ACTIVATION_USER_INACTIVE": "Dit account is niet actief. Neem contact op met een beheerder.",
    "errors.REFRESH_TOKEN_REVOKED": "Uw sessie is verlopen. Log opnieuw in.",
    "errors.USER_NO_LONGER_ACTIVE": "Dit account is niet langer actief.",
    "errors.LOGOUT_REVOCATION_UNAVAILABLE": "We konden het uitloggen niet voltooien. Probeer het opnieuw.",
    "errors.IMPERSONATION_REFRESH_FORBIDDEN": "Impersonatiesessies kunnen niet worden vernieuwd.",

    # --- autorisatie / rollen ---
    "errors.PERMISSION_DENIED": "U heeft geen toestemming om deze actie uit te voeren.",
    "errors.SUPERUSER_REQUIRED": "Voor deze actie zijn superbeheerdersrechten vereist.",
    "errors.PROCESSOR_UNREACHABLE": "De verwerkingsservice is momenteel onbereikbaar. Probeer het zo opnieuw.",
    "errors.ORG_ADMIN_REQUIRED": "Voor deze actie zijn beheerdersrechten voor deze organisatie vereist.",
    "errors.ORG_MEMBERSHIP_REQUIRED": "U moet lid zijn van deze organisatie om door te gaan.",
    "errors.INSUFFICIENT_PROJECT_ROLE": "Uw rol in dit project staat deze actie niet toe.",
    "errors.NOT_ORG_MEMBER": "U bent geen lid van deze organisatie.",
    "errors.SELF_ACTION_FORBIDDEN": "U kunt deze actie niet op uw eigen account uitvoeren.",
    "errors.UNSUPPORTED_COUNTRY": "Dat land is geen ondersteund rechtsgebied.",
    "errors.INVALID_PROJECT_ROLE": "Die projectrol is ongeldig.",
    "errors.TARGET_NOT_IN_ORG": "Die gebruiker is geen lid van deze organisatie.",
    "errors.USER_NOT_IN_PROJECT_ORG": "Die gebruiker is geen lid van de organisatie van het project.",
    "errors.GUEST_CANNOT_CREATE_PROJECT": "Gasten kunnen geen projecten aanmaken.",
    "errors.GUEST_CANNOT_BE_OWNER": "Gasten kunnen niet als projecteigenaar worden ingesteld.",
    "errors.GUEST_CANNOT_BE_ORG_ADMIN": "Gasten kunnen geen organisatiebeheerder worden.",
    "errors.GUEST_REQUIRES_PROJECTS": "Wijs minstens één project toe wanneer u een gast uitnodigt.",

    # --- impersonatie (superbeheerder) ---
    "errors.CANNOT_IMPERSONATE_SELF": "U kunt uzelf niet imiteren.",
    "errors.CANNOT_IMPERSONATE_SUPERUSER": "U kunt geen andere superbeheerder imiteren.",
    "errors.CANNOT_IMPERSONATE_INACTIVE": "U kunt geen inactieve gebruiker imiteren.",
    "errors.CANNOT_IMPERSONATE_UNVERIFIED": "U kunt geen niet-geverifieerde gebruiker imiteren.",
    "errors.NOT_AN_IMPERSONATION_SESSION": "Dit is geen impersonatiesessie, dus er is niets om te stoppen.",
    "errors.IMPERSONATION_STOP_UNAVAILABLE": "We konden de impersonatiesessie niet beëindigen. Probeer het opnieuw.",

    # --- gebruikers / leden ---
    "errors.USER_NOT_FOUND": "Die gebruiker kon niet worden gevonden.",
    "errors.MEMBER_NOT_FOUND": "Dat lid kon niet worden gevonden.",
    "errors.MEMBER_NOT_PENDING": "De uitnodiging van dat lid is niet langer in behandeling.",
    "errors.MEMBER_ALREADY_EXISTS": "Die gebruiker is al lid.",
    "errors.ORG_MEMBER_ALREADY_EXISTS": "Die gebruiker is al lid van deze organisatie.",
    "errors.CANNOT_DEACTIVATE_SELF": "U kunt uw eigen account niet deactiveren.",
    "errors.LAST_ADMIN_REQUIRED": "U kunt de laatste beheerder niet verwijderen.",
    "errors.LAST_SUPERUSER_REQUIRED": "U kunt de laatste superbeheerder niet verwijderen.",
    "errors.OWNER_NOT_REMOVABLE": "De projecteigenaar kan niet worden verwijderd.",
    "errors.OWNER_ROLE_NOT_ASSIGNABLE": "De eigenaarsrol kan niet op deze manier worden toegewezen.",
    "errors.OWNER_ROLE_NOT_CHANGEABLE": "De rol van de eigenaar kan niet worden gewijzigd.",
    "errors.OWNS_ACTIVE_PROJECTS": "Deze gebruiker heeft nog actieve projecten in eigendom. Wijs deze eerst opnieuw toe.",
    "errors.DEMOTE_ADMIN_BEFORE_GUEST": "Ontneem dit lid eerst de beheerdersrechten voordat u het een gast maakt.",
    "errors.REASSIGN_TARGET_NOT_ELIGIBLE": "Die gebruiker kan deze projecten niet ontvangen.",
    "errors.ASSIGNEE_NOT_A_PROJECT_MEMBER": "De toegewezen persoon moet lid zijn van dit project.",
    "errors.INVALID_FINDING_FILTER": "Een van de rapportfilters is ongeldig.",

    # --- uitnodigingen / toegangsverzoeken ---
    "errors.INVITATION_NOT_FOUND": "Die uitnodiging kon niet worden gevonden.",
    "errors.INVITATION_EXPIRED": "Deze uitnodiging is verlopen.",
    "errors.ORG_INVITE_ALREADY_PENDING": "Er is al een uitnodiging voor deze gebruiker in behandeling.",
    "errors.ORG_MEMBER_SUSPENDED": "De toegang van dit lid is opgeschort. Activeer het lidmaatschap opnieuw voordat je deze persoon aan een project toevoegt.",
    "errors.ALREADY_REVOKED": "Dit is al ingetrokken.",
    "errors.ACCESS_REQUEST_NOT_FOUND": "Dat toegangsverzoek kon niet worden gevonden.",
    "errors.ACCESS_REQUEST_NOT_PENDING": "Dat toegangsverzoek is niet langer in behandeling.",

    # --- organisaties ---
    "errors.ORG_NOT_FOUND": "Die organisatie kon niet worden gevonden.",
    "errors.ORG_NOT_AVAILABLE": "Deze organisatie is momenteel niet beschikbaar.",
    "errors.ORG_NOT_ACTIVE": "Deze organisatie is niet actief.",
    "errors.ORG_SUSPENDED": "Deze organisatie is opgeschort. Neem contact op met een superbeheerder om de toegang te herstellen.",
    "errors.ORG_NAME_TAKEN": "Die organisatienaam is al in gebruik.",
    "errors.ORG_STATUS_NOT_TRANSITIONABLE": "De status van deze organisatie kan niet op die manier worden gewijzigd.",
    "errors.ORG_NOT_DELETED": "Deze organisatie is niet verwijderd en kan daarom niet definitief worden verwijderd.",
    "errors.ORG_PURGE_NOT_DUE": "Deze organisatie zit nog in de bewaarperiode en kan nog niet definitief worden verwijderd.",
    "errors.NO_ACTIVE_ORGANIZATION": "Selecteer een organisatie voordat u doorgaat.",
    "errors.SEAT_LIMIT_EXCEEDED": "Maximumaantal gebruikers bereikt. Verhoog de limiet of verwijder een lid voordat u iemand uitnodigt.",
    "errors.SEAT_LIMIT_BELOW_USAGE": "De nieuwe gebruikerslimiet ligt onder het huidige gebruik.",
    "errors.STORAGE_LIMIT_BELOW_USAGE": "De nieuwe opslaglimiet ligt onder het huidige gebruik.",
    "errors.PROVISIONING_FAILED": "We konden het instellen van de organisatie niet voltooien. Probeer het opnieuw.",

    # --- projecten ---
    "errors.PROJECT_NOT_FOUND": "Dat project kon niet worden gevonden.",
    "errors.PROJECT_NAME_CONFLICT": "Er bestaat al een project met die naam.",
    "errors.PROJECT_ARCHIVED": "Dit project is gearchiveerd. Heractiveer het om wijzigingen aan te brengen.",
    "errors.PROJECT_NOT_ARCHIVED": "Dit project is niet gearchiveerd.",
    "errors.NAME_EMPTY_AFTER_TRIM": "De naam mag niet leeg zijn.",
    "errors.CONSEQUENCE_CLASS_OUT_OF_SCOPE": "Die gevolgklasse is niet geldig voor het gekozen land.",
    "errors.INSTRUMENT_NOT_REGISTERED": "Dat instrument is niet beschikbaar voor het gekozen land.",

    # --- documenten / versies ---
    "errors.DOCUMENT_NOT_FOUND": "Dat document kon niet worden gevonden.",
    "errors.DOCUMENT_NAME_CONFLICT": "Er bestaat al een document met die naam.",
    "errors.DOCUMENT_FILE_TYPE_LOCKED": "Het bestandstype van dit document kan niet meer worden gewijzigd.",
    "errors.DOCUMENT_LEVEL_NOT_FOR_IFC": "Een 3D-model kan niet aan een verdieping worden toegewezen; verdiepingen zijn voor 2D-tekeningen.",
    "errors.LEVEL_NOT_FOUND": "Die verdieping kon niet worden gevonden.",
    "errors.LEVEL_NAME_CONFLICT": "Er bestaat al een verdieping met die naam.",
    "errors.VERSION_NUMBER_CONFLICT": "Dat versienummer is al in gebruik.",
    "errors.SOURCE_NOT_RESTORABLE": "Alleen een gereede, volledig verwerkte versie kan worden hersteld.",
    "errors.VERSION_ALREADY_HEAD": "Die versie is al de huidige versie.",

    # --- verdiepingen / uitgelijnde tekeningen (PDF<->3D) ---
    "errors.STOREY_NOT_FOUND": "Die verdieping kon niet worden gevonden.",
    "errors.ALIGNED_SHEET_NOT_FOUND": "Die uitgelijnde tekening kon niet worden gevonden.",
    "errors.ALIGNED_SHEET_PDF_DOCUMENT_INVALID": "Kies een PDF-document om uit te lijnen.",
    "errors.ALIGNED_SHEET_STOREY_DOCUMENT_MISMATCH": "Die verdieping hoort niet bij het gekozen document.",
    "errors.ALIGNED_SHEET_DEGENERATE_POINTS": "Kies aan beide kanten twee verschillende punten om de tekening uit te lijnen.",
    "errors.ALIGNED_SHEET_DUPLICATE": "Deze tekeningpagina is al uitgelijnd op die verdieping.",

    # --- bestanden / uploads / opslag ---
    "errors.FILE_NOT_FOUND": "Dat bestand kon niet worden gevonden.",
    "errors.PROJECT_FILE_NOT_FOUND": "Dat projectbestand kon niet worden gevonden.",
    "errors.FILE_NOT_READY": "Dit bestand is nog niet gereed.",
    "errors.FILE_ALREADY_FINALIZED": "Dit bestand is al afgerond.",
    "errors.FILE_TOO_LARGE": "Dit bestand is te groot.",
    "errors.INVALID_FILE_EXTENSION": "Dat bestandstype wordt niet ondersteund.",
    "errors.DUPLICATE_FILE_CONTENT": "Dit bestand is identiek aan een bestand dat al is geüpload.",
    "errors.DUPLICATE_CONTENT": "Deze inhoud is identiek aan iets dat al is geüpload.",
    "errors.OBJECT_NOT_UPLOADED": "Het bestand is niet geüpload. Probeer het opnieuw.",
    "errors.MISSING_STORAGE_KEY": "Dit item heeft geen opgeslagen bestand.",
    "errors.SIZE_MISMATCH": "De geüploade bestandsgrootte komt niet overeen met wat werd verwacht.",
    "errors.INVALID_ASSET_KEY": "Die assetverwijzing is ongeldig.",

    # --- extractie / viewer ---
    "errors.EXTRACTION_NOT_COMPLETE": "Het extraheren van het document is nog niet voltooid.",
    "errors.EXTRACTION_NOT_FAILED": "Deze extractie is niet mislukt en kan dus niet opnieuw worden geprobeerd.",
    "errors.VIEWER_BUNDLE_NOT_READY": "De gegevens voor de 3D-viewer zijn nog niet gereed.",

    # --- avatars / afbeeldingen / miniaturen ---
    "errors.NO_AVATAR": "Er is geen avatar om te verwijderen.",
    "errors.AVATAR_INVALID_TYPE": "Dat afbeeldingstype wordt niet ondersteund voor avatars.",
    "errors.AVATAR_TOO_LARGE": "Die avatarafbeelding is te groot.",
    "errors.ORG_IMAGE_INVALID_TYPE": "Dat afbeeldingstype wordt niet ondersteund.",
    "errors.ORG_IMAGE_TOO_LARGE": "Die afbeelding is te groot.",
    "errors.THUMBNAIL_UNSUPPORTED_TYPE": "Dat type miniatuurafbeelding wordt niet ondersteund.",
    "errors.THUMBNAIL_TOO_LARGE": "Die miniatuurafbeelding is te groot.",

    # --- bevindingen ---
    "errors.FINDING_NOT_FOUND": "Die bevinding kon niet worden gevonden.",
    "errors.FINDING_ILLEGAL_TRANSITION": "Die statuswijziging is niet toegestaan voor deze bevinding.",
    "errors.FINDING_RESOLVE_REQUIRES_EVIDENCE": "Voeg bewijs toe voordat u deze bevinding oplost.",
    "errors.FINDING_VERIFY_REQUIRES_INSPECTOR": "Alleen een inspecteur kan deze bevinding verifiëren.",
    "errors.FINDING_PROMOTE_REQUIRES_DEADLINE_ASSIGNEE": "Stel een deadline en een toegewezen persoon in voordat u deze bevinding promoveert.",
    "errors.FINDING_TEMPLATE_NOT_FOUND": "Dat bevindingssjabloon bestaat niet meer.",
    "errors.FINDING_TEMPLATE_REQUIRED_FIELD": "Vul alle verplichte velden in.",

    # --- aangepaste velden bij bevindingen ---
    "errors.CUSTOM_FIELD_REQUIRED": "Vul alle verplichte velden in.",
    "errors.CUSTOM_FIELD_BAD_TEXT": "Een van de tekstvelden heeft een ongeldige waarde.",
    "errors.CUSTOM_FIELD_TOO_LONG": "Een van de velden is te lang.",
    "errors.CUSTOM_FIELD_NOT_A_NUMBER": "Een van de velden moet een getal zijn.",
    "errors.CUSTOM_FIELD_NUMBER_OUT_OF_RANGE": "Een van de numerieke velden valt buiten het toegestane bereik.",
    "errors.CUSTOM_FIELD_BAD_DATE": "Een van de datumvelden is ongeldig.",
    "errors.CUSTOM_FIELD_BAD_OPTION": "Een van de velden heeft een optie die niet is toegestaan.",
    "errors.CUSTOM_FIELD_UNKNOWN_TYPE": "Een van de velden heeft een niet-ondersteund type.",
    "errors.CUSTOM_VALUES_WITHOUT_TEMPLATE": "Deze bevinding heeft geen sjabloon, dus aangepaste velden kunnen niet worden ingesteld.",
    "errors.UNKNOWN_CUSTOM_FIELD": "Deze bevinding bevat een veld dat niet in het sjabloon staat.",

    # --- sjablonen (bevindingsformulieren / rapportlay-outs) ---
    "errors.ORG_TEMPLATE_NOT_FOUND": "Dat sjabloon kon niet worden gevonden.",
    "errors.REPORT_TEMPLATE_NOT_FOUND": "Dat rapportsjabloon kon niet worden gevonden.",
    "errors.CANNOT_DELETE_DEFAULT_TEMPLATE": "U kunt het standaardsjabloon niet verwijderen. Stel eerst een ander sjabloon als standaard in.",
    "errors.DEFAULT_TEMPLATE_CONFLICT": "Er is zojuist een ander sjabloon als standaard ingesteld. Probeer het opnieuw.",
    "errors.TEMPLATE_TYPE_MISMATCH": "Dat sjabloon is van het verkeerde type voor deze actie.",
    "errors.SCHEMA_NOT_AVAILABLE_FOR_TYPE": "Er is geen schema beschikbaar voor dit sjabloontype.",
    "errors.INVALID_CONFIG": "De sjabloonconfiguratie is ongeldig.",
    "errors.UNKNOWN_SECTION_KEY": "Het sjabloon verwijst naar een sectie die niet bestaat.",
    "errors.UNKNOWN_BUILTIN_FIELD": "Het sjabloon verwijst naar een veld dat niet bestaat.",
    "errors.DUPLICATE_FIELD_ID": "Twee velden hebben dezelfde id.",
    "errors.DUPLICATE_FIELD_LABEL": "Twee velden hebben hetzelfde label.",
    "errors.DUPLICATE_SECTION_KEY": "Twee secties hebben dezelfde sleutel.",
    "errors.DUPLICATE_TEXT_BLOCK_ID": "Twee tekstblokken hebben dezelfde id.",
    "errors.TOO_MANY_FIELDS": "Dit sjabloon heeft te veel velden.",
    "errors.MIN_GREATER_THAN_MAX": "Het minimum mag niet groter zijn dan het maximum.",
    "errors.MINMAX_ONLY_FOR_NUMBER": "Minimum en maximum gelden alleen voor numerieke velden.",
    "errors.OPTIONS_ONLY_FOR_SELECT": "Opties gelden alleen voor keuzevelden.",
    "errors.SELECT_FIELD_NEEDS_OPTIONS": "Een keuzeveld heeft minstens één optie nodig.",
    "errors.SELECT_OPTION_EMPTY": "Keuzeopties mogen niet leeg zijn.",
    "errors.SELECT_OPTIONS_NOT_UNIQUE": "Keuzeopties moeten uniek zijn.",

    # --- borgingsplan / momenten / checklist ---
    "errors.BORGINGSPLAN_NOT_FOUND": "Dat borgingsplan kon niet worden gevonden.",
    "errors.BORGINGSMOMENT_NOT_FOUND": "Dat borgingsmoment kon niet worden gevonden.",
    "errors.CHECKLIST_ITEM_NOT_FOUND": "Dat checklist-item kon niet worden gevonden.",
    "errors.NO_ACTIVE_PLAN": "Dit project heeft geen actief borgingsplan.",
    "errors.NO_ASSURANCE_PLAN": "Dit project heeft geen borgingsplan.",
    "errors.PLAN_NOT_EDITABLE": "Dit borgingsplan kan niet meer worden bewerkt.",
    "errors.PLAN_ALREADY_PUBLISHED": "Dit borgingsplan is al gepubliceerd.",
    "errors.PLAN_NOT_PUBLISHED": "Dit borgingsplan is nog niet gepubliceerd.",
    "errors.PUBLISHED_PLAN_EXISTS": "Er bestaat al een gepubliceerd borgingsplan.",
    "errors.PLAN_GENERATION_RACE": "Het plan is zojuist elders gewijzigd. Vernieuw de pagina en probeer het opnieuw.",
    "errors.MOMENT_ALREADY_COMPLETED": "Dit moment is al afgerond.",
    "errors.MOMENT_NOT_IN_PROGRESS": "Dit moment is niet in uitvoering.",
    "errors.REORDER_ITEM_IDS_MISMATCH": "De opnieuw geordende items komen niet overeen met de huidige lijst. Vernieuw de pagina.",
    "errors.REORDER_MOMENT_IDS_MISMATCH": "De opnieuw geordende momenten komen niet overeen met de huidige lijst. Vernieuw de pagina.",
    "errors.NVT_REQUIRES_NOTE": "Voeg een notitie toe om dit als niet van toepassing te markeren.",
    "errors.INCOMPLETE_INSPECTION": "Voltooi de inspectie voordat u doorgaat.",

    # --- deadlines ---
    "errors.DEADLINE_NOT_FOUND": "Die deadline kon niet worden gevonden.",
    "errors.DEADLINE_NOT_APPLICABLE": "Die deadline is hier niet van toepassing.",
    "errors.UNKNOWN_DEADLINE_TYPE": "Dat deadlinetype wordt niet herkend.",

    # --- risico's ---
    "errors.RISK_NOT_FOUND": "Dat risico kon niet worden gevonden.",

    # --- naleving / rapporten ---
    "errors.MISSING_ARTIFACTS": "De vereiste bestanden voor deze controle ontbreken.",
    "errors.NO_COMPLIANCE_DATA": "Er zijn nog geen nalevingsgegevens voor dit project.",
    "errors.NO_COMPLIANCE_RESULTS": "Er zijn nog geen nalevingsresultaten beschikbaar.",
    "errors.COMPLIANCE_CHECK_FAILED": "De nalevingscontrole kon niet worden voltooid. Probeer het opnieuw.",
    "errors.FRAMEWORK_NOT_REGISTERED": "Dat regelgevingskader is niet beschikbaar voor dit project.",
    "errors.REPORT_NOT_FOUND": "Dat rapport kon niet worden gevonden.",
    "errors.REPORT_NOT_READY": "Dit rapport is nog niet gereed.",
    "errors.REPORT_ALREADY_SIGNED": "Dit rapport is al ondertekend.",
    "errors.REPORT_TYPE_NOT_AVAILABLE": "Dat rapporttype is niet beschikbaar voor dit project.",
    "errors.NOT_A_DECLARATION": "Dit rapport is geen verklaring.",

    # --- taken ---
    "errors.JOB_NOT_FOUND": "Die taak kon niet worden gevonden.",
    "errors.JOB_NOT_FAILED": "Deze taak is niet mislukt en kan dus niet opnieuw worden geprobeerd.",
    "errors.JOB_NOT_RETRIABLE": "Deze taak kan niet opnieuw worden geprobeerd.",
    "errors.JOB_TYPE_NOT_RETRYABLE": "Dit type taak kan niet opnieuw worden geprobeerd.",
    "errors.JOB_ALREADY_RUNNING": "Deze taak wordt al uitgevoerd.",
    "errors.JOB_NOT_CANCELLABLE": "Deze taak kan niet worden geannuleerd.",
    "errors.CANCEL_DISPATCH_FAILED": "We konden de taak niet annuleren. Probeer het opnieuw.",
    "errors.TOO_MANY_ACTIVE_JOBS": "Er worden al te veel taken uitgevoerd. Wacht tot er een is voltooid.",
    "errors.INVALID_CALLBACK_STATUS": "De taak rapporteerde een onverwachte status.",
    "errors.INVALID_STORAGE_KEY": "De taak rapporteerde een opslaglocatie buiten dit project.",

    # --- bijlagen / certificaten ---
    "errors.ATTACHMENT_NOT_FOUND": "Die bijlage kon niet worden gevonden.",
    "errors.ATTACHMENT_NOT_PENDING": "Die bijlage wacht niet langer op upload.",
    "errors.ATTACHMENT_NOT_READY": "Die bijlage is nog niet gereed.",
    "errors.CERTIFICATE_NOT_FOUND": "Dat certificaat kon niet worden gevonden.",
    "errors.CERTIFICATE_NOT_PENDING": "Dat certificaat wacht niet langer op upload.",
    "errors.CERTIFICATE_NOT_READY": "Dat certificaat is nog niet gereed.",
    "errors.ORG_CERTIFICATE_NOT_FOUND": "Dat certificaat kon niet worden gevonden.",
    "errors.ORG_CERTIFICATE_NOT_PENDING": "Dat certificaat wacht niet langer op upload.",
    "errors.ORG_CERTIFICATE_NOT_READY": "Dat certificaat is nog niet gereed.",

    # --- BCF ---
    "errors.BCF_TOPIC_NOT_FOUND": "Dat BCF-onderwerp kon niet worden gevonden.",
    "errors.BCF_COMMENT_NOT_FOUND": "Die BCF-opmerking kon niet worden gevonden.",
    "errors.BCF_VIEWPOINT_NOT_FOUND": "Dat BCF-gezichtspunt kon niet worden gevonden.",
    "errors.INVALID_BCF_ARCHIVE": "Dat BCF-bestand is ongeldig of beschadigd.",

    # --- capture-links ---
    "errors.CAPTURE_LINK_NOT_FOUND": "Die capture-link kon niet worden gevonden.",
    "errors.CAPTURE_LINK_EXPIRED": "Deze capture-link is verlopen.",
    "errors.CAPTURE_LINK_REVOKED": "Deze capture-link is ingetrokken.",
    "errors.CAPTURE_LINK_EXHAUSTED": "Deze capture-link heeft de gebruikslimiet bereikt.",
    "errors.INVALID_CAPTURE_LINK": "Deze capture-link is ongeldig.",

    # --- statuswijzigingen ---
    "errors.INVALID_STATUS_TRANSITION": "Die statuswijziging is niet toegestaan.",

    # --- meldingen ---
    "errors.NOTIFICATION_NOT_FOUND": "Die melding kon niet worden gevonden.",

    # --- blog (beheer) ---
    "errors.BLOG_POST_NOT_FOUND": "Dat blogbericht kon niet worden gevonden.",
    "errors.BLOG_TITLE_EMPTY": "De titel mag niet leeg zijn.",
    "errors.BLOG_DESCRIPTION_EMPTY": "De beschrijving mag niet leeg zijn.",
    "errors.BLOG_CONTENT_EMPTY": "De inhoud mag niet leeg zijn.",
    "errors.BLOG_CONTENT_TOO_LARGE": "De inhoud is te groot.",
    "errors.BLOG_SLUG_INVALID": "Die slug is ongeldig.",
    "errors.BLOG_SLUG_TAKEN": "Die slug is al in gebruik.",
    "errors.BLOG_STATUS_INVALID": "Die status is ongeldig.",
    "errors.BLOG_LOCALE_INVALID": "Die taal is ongeldig.",
    "errors.BLOG_TAGS_INVALID": "Een of meer tags zijn ongeldig.",
    "errors.BLOG_PUBLISHED_AT_INVALID": "Die publicatiedatum is ongeldig.",
    "errors.BLOG_IMAGE_EMPTY": "Er is geen afbeelding opgegeven.",
    "errors.BLOG_IMAGE_INVALID_TYPE": "Dat afbeeldingstype wordt niet ondersteund.",
    "errors.BLOG_IMAGE_TOO_LARGE": "Die afbeelding is te groot.",
    "errors.BLOG_STORAGE_FAILED": "We konden de afbeelding niet opslaan. Probeer het opnieuw.",

    # ============================================================
    # Succesmeldingen — messages.<CODE>
    # ============================================================
    "messages.PROJECT_CREATED": "Project aangemaakt.",
    "messages.PROJECT_UPDATED": "Project bijgewerkt.",
    "messages.PROJECT_ARCHIVED": "Project gearchiveerd.",
    "messages.PROJECT_REACTIVATED": "Project geheractiveerd.",
    "messages.CHANGES_SAVED": "Wijzigingen opgeslagen.",
    "messages.MEMBER_INVITED": "Uitnodiging verzonden.",
    "messages.TEMPLATE_SAVED": "Sjabloon opgeslagen.",
    "messages.TEMPLATE_DELETED": "Sjabloon verwijderd.",
}
