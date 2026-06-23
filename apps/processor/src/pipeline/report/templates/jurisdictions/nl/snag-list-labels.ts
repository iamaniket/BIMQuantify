/**
 * NL (Dutch) labels for the per-recipient snag-list PDF (#G2). Code→label maps
 * mirror the neutral enum codes the API sends.
 */

export const NL_SNAG_LIST_LABELS = {
  reportTitle: 'Bevindingenlijst',
  kicker: 'Wet kwaliteitsborging voor het bouwen (Wkb)',
  reference: 'Projectkenmerk',
  address: 'Adres',
  recipient: 'Ontvanger',
  generatedAt: 'Gegenereerd op',
  scope: 'Selectie',
  scopeAll: 'Alle bevindingen',
  filterStatus: 'Status',
  filterSeverity: 'Ernst',

  sectionFindings: 'Bevindingen',
  severity: 'Ernst',
  findingStatus: 'Status',
  assignee: 'Toegewezen aan',
  deadline: 'Deadline',
  resolution: 'Oplossing',
  element: 'Element-ID',
  location: 'Locatie',
  page: 'Pagina',
  capturedAt: 'Vastgelegd',
  noFindings: 'Geen bevindingen gevonden voor deze selectie.',

  findingSeverities: {
    low: 'Laag',
    medium: 'Midden',
    high: 'Hoog',
  } as Record<string, string>,

  findingStatuses: {
    draft: 'Concept',
    open: 'Open',
    in_progress: 'In behandeling',
    resolved: 'Opgelost',
    verified: 'Geverifieerd',
  } as Record<string, string>,
} as const;

export type SnagListLabels = {
  [K in keyof typeof NL_SNAG_LIST_LABELS]: (typeof NL_SNAG_LIST_LABELS)[K] extends Record<
    string,
    string
  >
    ? Record<string, string>
    : string;
};
