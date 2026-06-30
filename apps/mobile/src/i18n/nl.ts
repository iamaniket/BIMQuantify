import type { MessageKey } from './en';

// Dutch catalog. Typed `Record<MessageKey, string>` so the type-checker fails on
// any key present in en.ts but missing here (and vice-versa) — compile-time NL/EN
// parity, mirroring the API's catalog-parity test. Finding labels reuse the
// portal's canonical Dutch (severity/status/resolution wording).
export const nl: Record<MessageKey, string> = {
  // --- generic ---
  'common.cancel': 'Annuleren',
  'common.retry': 'Opnieuw',
  'common.save': 'Opslaan',
  'common.error': 'Fout',
  'common.close': 'Sluiten',

  // --- sidebar / nav ---
  'nav.workspace': 'Werkruimte',
  'nav.projects': 'Projecten',
  'nav.settings': 'Instellingen',
  'nav.signOut': 'Uitloggen',
  'nav.tenant': 'Organisatie',
  'nav.admin': 'Beheerder',
  'nav.member': 'Lid',
  'nav.signedIn': 'Ingelogd',
  'nav.seats': '{used} plekken',
  'nav.seatsLimit': '{used}/{limit} plekken',
  'nav.switchTo': 'Wisselen naar {name}',
  'nav.brandTagline': 'BimDossier-platform',

  // --- projects list / header / toolbar ---
  'projects.list.loadError': 'Projecten konden niet worden geladen.',
  'projects.list.empty': 'Nog geen projecten.',
  'projects.list.noMatches': 'Geen overeenkomende projecten.',
  'projects.header.title': 'Projecten',
  'projects.header.count': '{active} actief · {archived} gearchiveerd',
  'projects.header.notificationsA11y': 'Meldingen',
  'projects.header.toggleThemeA11y': 'Thema wisselen',
  'projects.header.openMenuA11y': 'Menu openen',
  'projects.toolbar.searchPlaceholder': 'Projecten zoeken…',
  'projects.toolbar.showAllA11y': 'Alle projecten tonen',
  'projects.toolbar.showActiveA11y': 'Alleen actieve projecten tonen',
  'projects.toolbar.filterActive': 'Actief',
  'projects.toolbar.filterAll': 'Alle',
  'projects.toolbar.newProject': 'Nieuw project',
  'projects.toolbar.newProjectA11y': 'Nieuw project',
  'projects.nav.openMenuA11y': 'Menu openen',
  'projects.nav.menu': 'Menu',
  'projects.nav.projects': 'Projecten',
  'projects.card.openA11y': 'Project {name} openen',
  'projects.stats.active': 'Actief',
  'projects.stats.totalSub': '{total} totaal',
  'projects.stats.inConstruction': 'In uitvoering',
  'projects.stats.inDesignSub': '{count} in ontwerp',
  'projects.stats.inDesign': 'In ontwerp',
  'projects.stats.inProgressSub': 'in behandeling',
  'projects.stats.archived': 'Gearchiveerd',
  'projects.stats.archivedNone': 'geen',
  'projects.stats.archivedClosed': 'afgesloten',
  'projects.viewMode.changeViewA11y': 'Weergave wijzigen',
  'projects.viewMode.noFloorPlan': 'Geen plattegrond voor dit model',

  // --- organization picker ---
  'selectOrg.title': 'Kies een organisatie',
  'selectOrg.subtitle': 'Je hoort bij meer dan één. Kies er één om verder te gaan.',
  'selectOrg.error': 'Kon niet wisselen van organisatie. Probeer opnieuw.',

  // --- settings ---
  'settings.title': 'Instellingen',
  'settings.language': 'Taal',
  'settings.languageDutch': 'Nederlands',
  'settings.languageEnglish': 'Engels',
  'settings.offline.title': 'Offline-gegevens',
  'settings.offline.cached': '{projects} projecten · {findings} bevindingen · {documents} documenten in cache',
  'settings.offline.pinned': '{models} modellen offline opgeslagen · {size}',
  'settings.offline.empty': 'Nog geen offline-gegevens op dit apparaat.',
  'settings.offline.clear': 'Offline-gegevens wissen',
  'settings.offline.clearConfirmTitle': 'Offline-gegevens wissen?',
  'settings.offline.clearConfirmBody':
    'Projecten, bevindingen en gedownloade modellen in de cache worden van dit apparaat verwijderd. Je blijft ingelogd.',
  'settings.offline.clearConfirmBodyPending':
    '{count} niet-gesynchroniseerde wijziging(en) zijn nog niet bij de server aangekomen en gaan verloren. Gegevens in de cache en gedownloade modellen worden ook verwijderd. Je blijft ingelogd.',
  'settings.offline.cleared': 'Offline-gegevens gewist.',

  // --- offline / sync ---
  'offline.banner': 'Offline — opgeslagen gegevens worden getoond. Wijzigingen synchroniseren zodra je weer verbinding hebt.',
  'offline.pending': '{count} in wachtrij',
  'offline.syncing': '{count} synchroniseren',
  'offline.failed': '{count} mislukt — opnieuw',
  'offline.conflicts': '{count} conflicten',
  'offline.conflictTitle': 'Synchronisatieconflict',
  'offline.conflictBody':
    'Sommige wijzigingen konden niet worden toegepast omdat de bevinding op de server is gewijzigd. De serverversie is behouden.',
  'offline.savedOffline': 'Offline opgeslagen — wordt gesynchroniseerd zodra je weer verbinding hebt.',

  // --- photo strip ---
  'photos.addTitle': 'Foto toevoegen',
  'photos.takePhoto': 'Foto maken',
  'photos.chooseLibrary': 'Kies uit bibliotheek',
  'photos.queued': 'In wachtrij',
  'photos.add': 'Foto',

  // --- viewer ---
  'viewer.title': 'Viewer',
  'viewer.notConfigured': 'Viewer niet geconfigureerd',
  'viewer.notConfiguredBody':
    'Stel EXPO_PUBLIC_VIEWER_EMBED_URL in op een gehoste build van apps/viewer-embed om het 3D-model hier te laden.',
  'viewer.rendererCrashed': 'Renderer vastgelopen',
  'viewer.rendererCrashedBody': 'De 3D-viewer had onvoldoende geheugen of is door het systeem afgesloten.',
  'viewer.tapReload': 'Tik om opnieuw te laden',
  'viewer.loadFailed': 'Kon het model niet laden',
  'viewer.loadFailedOnline': 'Probeer het opnieuw.',
  'viewer.loadFailedOffline': 'Sla dit model op voor offline gebruik terwijl je verbinding hebt.',
  'viewer.notViewable': 'Niet weer te geven',
  'viewer.notViewableBody': 'Dit bestand heeft geen 3D-model om weer te geven.',
  'viewer.error': 'Viewerfout',
  'viewer.tapRetry': 'Tik om opnieuw te proberen',
  'viewer.loadingModel': 'Model laden…',
  'viewer.rendering': 'Renderen…',
  'viewer.saveOffline': 'Opslaan voor offline',
  'viewer.removeOffline': 'Offline-download verwijderen',

  // --- project screen (Documents | Findings) ---
  'project.documentsTab': 'Documenten',
  'project.findingsTab': 'Bevindingen',
  'project.documentsTitle': 'Documenten',
  'project.noDocuments': 'Geen documenten in dit project.',
  'project.loadDocumentsError': 'Kon documenten niet laden.',
  'project.processing': 'verwerken…',
  'project.addSnag': 'Bevinding toevoegen',

  // --- findings: enum labels ---
  'findings.severity.low': 'Laag',
  'findings.severity.medium': 'Middel',
  'findings.severity.high': 'Hoog',
  'findings.status.draft': 'Concept',
  'findings.status.open': 'Open',
  'findings.status.in_progress': 'In behandeling',
  'findings.status.resolved': 'Opgelost',
  'findings.status.verified': 'Geverifieerd',

  // --- findings: list ---
  'findings.list.empty': 'Nog geen bevindingen.',
  'findings.list.loadError': 'Kon bevindingen niet laden.',
  'findings.list.notSynced': 'Niet gesynchroniseerd',

  // --- findings: create ---
  'findings.create.title': 'Nieuwe bevinding',
  'findings.create.titleLabel': 'Titel',
  'findings.create.titlePlaceholder': 'Korte omschrijving van het probleem',
  'findings.create.descriptionLabel': 'Omschrijving',
  'findings.create.descriptionPlaceholder': 'Gedetailleerde omschrijving',
  'findings.create.severityLabel': 'Ernst',
  'findings.create.photosLabel': "Foto's",
  'findings.create.save': 'Bevinding opslaan',
  'findings.create.titleRequired': 'Titel verplicht',
  'findings.create.titleRequiredBody': 'Voer een titel in voor de bevinding.',
  'findings.create.descriptionRequired': 'Omschrijving verplicht',
  'findings.create.descriptionRequiredBody': 'Voer een omschrijving in.',
  'findings.create.pinnedPdf': 'Vastgepind op PDF-pagina {page}',
  'findings.create.pinned3d': 'Vastgepind op 3D ({coords})',

  // --- findings: detail ---
  'findings.detail.fallbackTitle': 'Bevinding',
  'findings.detail.loadError': 'Kon bevinding niet laden.',
  'findings.detail.bblArticle': 'Bbl-artikel',
  'findings.detail.deadline': 'Deadline',
  'findings.detail.anchor': 'Locatie',
  'findings.detail.resolution': 'Oplossing',
  'findings.detail.photos': "Foto's",
  'findings.detail.resolutionEvidence': 'Bewijs van herstel',
  'findings.detail.photosOnline': "Foto's zijn beschikbaar wanneer je online bent.",
  'findings.detail.viewIn3d': 'Bekijk in 3D',
  'findings.detail.anchorPdf': 'PDF-pagina {page}',
  'findings.detail.anchor3d': '3D ({coords})',

  // --- findings: lifecycle actions ---
  'findings.actions.promote': 'Promoveren naar open',
  'findings.actions.startWork': 'Werk starten',
  'findings.actions.resolve': 'Oplossen',
  'findings.actions.reopen': 'Heropenen',
  'findings.actions.verify': 'Verifiëren',
  'findings.actions.rework': 'Terug voor herstel',
  'findings.actions.awaitingVerification': 'Wacht op verificatie door de kwaliteitsborger.',
  'findings.actions.terminal': 'Deze bevinding is geverifieerd en afgesloten.',
  'findings.actions.updateError': 'Kon de bevinding niet bijwerken.',

  // --- findings: promote sheet ---
  'findings.promote.title': 'Promoveren naar open',
  'findings.promote.hint': 'Stel een deadline in. De bevinding wordt aan jou toegewezen.',
  'findings.promote.deadlineLabel': 'Deadline',
  'findings.promote.quick1w': '+1 week',
  'findings.promote.quick2w': '+2 weken',
  'findings.promote.quick1m': '+1 maand',
  'findings.promote.customDate': 'JJJJ-MM-DD',
  'findings.promote.assignedToYou': 'Aan jou toegewezen',
  'findings.promote.submit': 'Promoveren',
  'findings.promote.deadlineRequired': 'Kies eerst een deadline.',
  'findings.promote.invalidDate': 'Voer een geldige datum in (JJJJ-MM-DD).',

  // --- findings: resolve sheet ---
  'findings.resolve.title': 'Bevinding oplossen',
  'findings.resolve.noteLabel': 'Toelichting oplossing',
  'findings.resolve.notePlaceholder': 'Beschrijf de uitgevoerde herstelmaatregel…',
  'findings.resolve.evidenceLabel': 'Bewijs van herstel',
  'findings.resolve.hint': 'Een toelichting en minimaal één bewijsfoto zijn verplicht.',
  'findings.resolve.submit': 'Markeren als opgelost',
  'findings.resolve.noteRequired': 'Voer een toelichting in.',
  'findings.resolve.evidenceRequired': 'Voeg minimaal één bewijsfoto toe.',

  // --- login: errors ---
  'login.error.invalidCredentials': 'Ongeldige e-mail of wachtwoord.',
  'login.error.signInFailed': 'Inloggen mislukt: {message}',
  'login.error.offline': 'Je bent offline. Maak verbinding met internet om in te loggen.',

  // --- login: offline ---
  'login.offline.banner': 'Je bent offline — maak verbinding om in te loggen.',

  // --- login: system status (KPI value + form status row) ---
  'login.status.normal': 'Normaal',
  'login.status.degraded': 'Verminderd',
  'login.status.down': 'Offline',
  'login.statusRow.normal': 'Alle systemen normaal',
  'login.statusRow.degraded': 'Verminderde prestaties',
  'login.statusRow.disruption': 'Storing',

  // --- login: sign-in form ---
  'login.form.eyebrow': 'Inloggen',
  'login.form.title': 'Welkom terug.',
  'login.form.newHere': 'Log in om verder te gaan. Nieuw hier? ',
  'login.form.requestAccess': 'Toegang aanvragen →',
  'login.form.emailLabel': 'Werk-e-mail',
  'login.form.emailPlaceholder': 'jij@bedrijf.nl',
  'login.form.forgot': 'Vergeten?',
  'login.form.passwordLabel': 'Wachtwoord',
  'login.form.rememberMe': 'Ingelogd blijven op dit apparaat',
  'login.form.submit': 'Inloggen',

  // --- login: hero / brand canvas ---
  'login.hero.subtext': 'Bouwkwaliteitsplatform',
  'login.hero.subtextTablet': 'Het bouwkwaliteitsplatform voor Nederlandse aannemers',
  'login.hero.pillMobile': 'Wkb · Actief in NL',
  'login.hero.pillTablet': 'Wkb gereed',
  // Words wrapped in *asterisks* render as italic accent spans (any word order).
  'login.hero.headline': 'Verweef je *modellen*, *bevindingen* en *dossier* tot één Wkb-dossier.',
  'login.hero.subcopy':
    'Gefedereerde IFC-review, automatische toetsen op belangrijke Bouwbesluit-artikelen en een opleveringsklaar consumentendossier — voor bouwers die werken onder de Wet kwaliteitsborging voor het bouwen (Wkb).',

  // --- login: legal footer ---
  'login.footer.privacy': 'Privacybeleid',
  'login.footer.terms': 'Servicevoorwaarden',
  'login.footer.dpa': 'DPA',
};
