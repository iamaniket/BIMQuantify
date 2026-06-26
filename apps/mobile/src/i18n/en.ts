// English catalog. Flat, dotted keys (mirrors the API's i18n/messages/{en,nl}.py
// pattern — RN can't use the portal's next-intl). `{var}` placeholders are
// interpolated by translate(). `MessageKey` is derived from these keys; nl.ts is
// typed `Record<MessageKey, string>` so the type-checker enforces NL/EN parity.
export const en = {
  // --- generic ---
  'common.cancel': 'Cancel',
  'common.retry': 'Retry',
  'common.save': 'Save',
  'common.error': 'Error',
  'common.close': 'Close',

  // --- sidebar / nav ---
  'nav.workspace': 'Workspace',
  'nav.projects': 'Projects',
  'nav.settings': 'Settings',
  'nav.signOut': 'Sign out',
  'nav.tenant': 'Tenant',
  'nav.admin': 'Admin',
  'nav.member': 'Member',
  'nav.signedIn': 'Signed in',
  'nav.seats': '{used} seats',
  'nav.seatsLimit': '{used}/{limit} seats',
  'nav.switchTo': 'Switch to {name}',

  // --- organization picker ---
  'selectOrg.title': 'Choose an organization',
  'selectOrg.subtitle': 'You belong to more than one. Pick one to continue.',
  'selectOrg.error': 'Could not switch organization. Try again.',

  // --- settings ---
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.languageDutch': 'Dutch',
  'settings.languageEnglish': 'English',
  'settings.offline.title': 'Offline data',
  'settings.offline.cached': '{projects} projects · {findings} findings · {documents} documents cached',
  'settings.offline.pinned': '{models} models saved offline · {size}',
  'settings.offline.empty': 'No offline data stored on this device yet.',
  'settings.offline.clear': 'Clear offline data',
  'settings.offline.clearConfirmTitle': 'Clear offline data?',
  'settings.offline.clearConfirmBody':
    'Cached projects, findings and downloaded models will be removed from this device. You will stay signed in.',
  'settings.offline.clearConfirmBodyPending':
    '{count} unsynced change(s) have not reached the server yet and will be lost. Cached data and downloaded models will also be removed. You will stay signed in.',
  'settings.offline.cleared': 'Offline data cleared.',

  // --- offline / sync ---
  'offline.banner': 'Offline — showing saved data. Changes sync when you reconnect.',
  'offline.pending': '{count} pending',
  'offline.syncing': 'Syncing {count}',
  'offline.failed': '{count} failed — retry',
  'offline.conflicts': '{count} conflicts',
  'offline.conflictTitle': 'Sync conflict',
  'offline.conflictBody':
    'Some changes could not be applied because the finding changed on the server. The server version was kept.',
  'offline.savedOffline': 'Saved offline — it will sync when you reconnect.',

  // --- photo strip ---
  'photos.addTitle': 'Add photo',
  'photos.takePhoto': 'Take photo',
  'photos.chooseLibrary': 'Choose from library',
  'photos.queued': 'Queued',
  'photos.add': 'Photo',

  // --- viewer ---
  'viewer.title': 'Viewer',
  'viewer.notConfigured': 'Viewer not configured',
  'viewer.notConfiguredBody':
    'Set EXPO_PUBLIC_VIEWER_EMBED_URL to a served build of apps/viewer-embed to load the 3D model here.',
  'viewer.rendererCrashed': 'Renderer crashed',
  'viewer.rendererCrashedBody': 'The 3D viewer ran out of memory or was terminated by the OS.',
  'viewer.tapReload': 'Tap to reload',
  'viewer.loadFailed': "Couldn't load the model",
  'viewer.loadFailedOnline': 'Please try again.',
  'viewer.loadFailedOffline': 'Save this model for offline use while you have a connection.',
  'viewer.notViewable': 'Not viewable',
  'viewer.notViewableBody': 'This file has no 3D model to display.',
  'viewer.error': 'Viewer error',
  'viewer.tapRetry': 'Tap to retry',
  'viewer.loadingModel': 'Loading model…',
  'viewer.rendering': 'Rendering…',
  'viewer.saveOffline': 'Save for offline',
  'viewer.removeOffline': 'Remove offline download',

  // --- project screen (Documents | Findings) ---
  'project.documentsTab': 'Documents',
  'project.findingsTab': 'Findings',
  'project.documentsTitle': 'Documents',
  'project.noDocuments': 'No documents in this project.',
  'project.loadDocumentsError': 'Couldn’t load documents.',
  'project.processing': 'processing…',
  'project.addSnag': 'Add snag',

  // --- findings: enum labels ---
  'findings.severity.low': 'Low',
  'findings.severity.medium': 'Medium',
  'findings.severity.high': 'High',
  'findings.status.draft': 'Draft',
  'findings.status.open': 'Open',
  'findings.status.in_progress': 'In progress',
  'findings.status.resolved': 'Resolved',
  'findings.status.verified': 'Verified',

  // --- findings: list ---
  'findings.list.empty': 'No findings yet.',
  'findings.list.loadError': 'Couldn’t load findings.',
  'findings.list.notSynced': 'Not synced',

  // --- findings: create ---
  'findings.create.title': 'New finding',
  'findings.create.titleLabel': 'Title',
  'findings.create.titlePlaceholder': 'Short description of the issue',
  'findings.create.descriptionLabel': 'Description',
  'findings.create.descriptionPlaceholder': 'Detailed description',
  'findings.create.severityLabel': 'Severity',
  'findings.create.photosLabel': 'Photos',
  'findings.create.save': 'Save finding',
  'findings.create.titleRequired': 'Title required',
  'findings.create.titleRequiredBody': 'Please enter a title for the finding.',
  'findings.create.descriptionRequired': 'Description required',
  'findings.create.descriptionRequiredBody': 'Please enter a description.',
  'findings.create.pinnedPdf': 'Pinned to PDF page {page}',
  'findings.create.pinned3d': 'Pinned to 3D ({coords})',

  // --- findings: detail ---
  'findings.detail.fallbackTitle': 'Finding',
  'findings.detail.loadError': "Couldn't load finding.",
  'findings.detail.bblArticle': 'Bbl article',
  'findings.detail.deadline': 'Deadline',
  'findings.detail.anchor': 'Anchor',
  'findings.detail.resolution': 'Resolution',
  'findings.detail.photos': 'Photos',
  'findings.detail.resolutionEvidence': 'Resolution evidence',
  'findings.detail.photosOnline': 'Photos are available when you’re online.',
  'findings.detail.viewIn3d': 'View in 3D',
  'findings.detail.anchorPdf': 'PDF page {page}',
  'findings.detail.anchor3d': '3D ({coords})',

  // --- findings: lifecycle actions ---
  'findings.actions.promote': 'Promote to open',
  'findings.actions.startWork': 'Start work',
  'findings.actions.resolve': 'Resolve',
  'findings.actions.reopen': 'Reopen',
  'findings.actions.verify': 'Verify',
  'findings.actions.rework': 'Send back for rework',
  'findings.actions.awaitingVerification': 'Awaiting verification by the quality inspector.',
  'findings.actions.terminal': 'This finding is verified and closed.',
  'findings.actions.updateError': 'Could not update the finding.',

  // --- findings: promote sheet ---
  'findings.promote.title': 'Promote to open',
  'findings.promote.hint': 'Set a deadline. The finding will be assigned to you.',
  'findings.promote.deadlineLabel': 'Deadline',
  'findings.promote.quick1w': '+1 week',
  'findings.promote.quick2w': '+2 weeks',
  'findings.promote.quick1m': '+1 month',
  'findings.promote.customDate': 'YYYY-MM-DD',
  'findings.promote.assignedToYou': 'Assigned to you',
  'findings.promote.submit': 'Promote',
  'findings.promote.deadlineRequired': 'Pick a deadline first.',
  'findings.promote.invalidDate': 'Enter a valid date (YYYY-MM-DD).',

  // --- findings: resolve sheet ---
  'findings.resolve.title': 'Resolve finding',
  'findings.resolve.noteLabel': 'Resolution note',
  'findings.resolve.notePlaceholder': 'Describe the corrective action taken…',
  'findings.resolve.evidenceLabel': 'Resolution evidence',
  'findings.resolve.hint': 'A note and at least one evidence photo are required.',
  'findings.resolve.submit': 'Mark as resolved',
  'findings.resolve.noteRequired': 'Please enter a resolution note.',
  'findings.resolve.evidenceRequired': 'Please attach at least one evidence photo.',

  // --- login: errors ---
  'login.error.invalidCredentials': 'Invalid email or password.',
  'login.error.signInFailed': 'Sign in failed: {message}',
  'login.error.offline': "You're offline. Connect to the internet to sign in.",

  // --- login: offline ---
  'login.offline.banner': "You're offline — connect to sign in.",

  // --- login: system status (KPI value + form status row) ---
  'login.status.normal': 'Normal',
  'login.status.degraded': 'Degraded',
  'login.status.down': 'Down',
  'login.statusRow.normal': 'All systems normal',
  'login.statusRow.degraded': 'Degraded performance',
  'login.statusRow.disruption': 'Service disruption',

  // --- login: sign-in form ---
  'login.form.eyebrow': 'Sign in',
  'login.form.title': 'Welcome back.',
  'login.form.newHere': 'Sign in to continue. New here? ',
  'login.form.requestAccess': 'Request access →',
  'login.form.emailLabel': 'Work email',
  'login.form.emailPlaceholder': 'you@company.nl',
  'login.form.forgot': 'Forgot?',
  'login.form.passwordLabel': 'Password',
  'login.form.rememberMe': 'Keep me signed in on this device',
  'login.form.submit': 'Sign in',

  // --- login: hero / brand canvas ---
  'login.hero.subtext': 'Wkb-compliant BIM platform',
  'login.hero.subtextTablet': 'Quality Assurance in Construction Act (Wkb)-compliant BIM platform',
  'login.hero.pillMobile': 'Wkb {version} · Live in NL',
  'login.hero.pillTablet': 'Quality Assurance in Construction Act (Wkb) {version} Ready',
  // Words wrapped in *asterisks* render as italic accent spans (any word order).
  'login.hero.headline':
    'Stitch your *models*, *issues* and *dossier* into one Quality Assurance in Construction Act (Wkb) record.',
  'login.hero.subcopy':
    'Federated IFC review, automated Bouwbesluit checks and a delivery-ready consumentendossier — for builders working under the Quality Assurance in Construction Act (Wkb).',

  // --- login: legal footer ---
  'login.footer.privacy': 'Privacy policy',
  'login.footer.terms': 'Terms of service',
  'login.footer.dpa': 'DPA',
} as const;

export type MessageKey = keyof typeof en;
