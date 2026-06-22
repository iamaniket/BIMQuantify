/**
 * NL (Dutch) labels for the Dossier bevoegd gezag PDF (#33) — the full evidence
 * bundle filed at gereedmelding. Code→label maps mirror the neutral enum codes
 * the API sends.
 */

export const NL_DOSSIER_LABELS = {
  reportTitle: 'Dossier bevoegd gezag',
  kicker: 'Wet kwaliteitsborging voor het bouwen (Wkb)',
  reference: 'Projectkenmerk',
  address: 'Adres',
  generatedAt: 'Gegenereerd op',
  toc: 'Inhoudsopgave',

  sectionRisks: '1. Risicobeoordeling',
  sectionPlan: '2. Borgingsplan',
  sectionFindings: '3. Bevindingen',
  sectionCertificates: '4. Certificaten',
  sectionDeclaration: '5. Verklaring kwaliteitsborger',

  category: 'Categorie',
  level: 'Risiconiveau',
  riskDescription: 'Risico',
  mitigation: 'Beheersmaatregel',
  responsibleParty: 'Verantwoordelijke',
  article: 'Bbl-artikel',
  noRisks: "Geen risico's vastgelegd.",

  plannedDate: 'Gepland',
  actualDate: 'Uitgevoerd',
  noMoments: 'Geen borgingsmomenten vastgelegd.',

  severity: 'Ernst',
  findingStatus: 'Status',
  resolution: 'Oplossing',
  deadline: 'Deadline',
  noFindings: 'Geen bevindingen vastgelegd.',
  element: 'Element-ID',
  location: 'Locatie',
  page: 'Pagina',

  certType: 'Type',
  certNumber: 'Nummer',
  issuer: 'Verstrekker',
  validUntil: 'Geldig tot',
  noCertificates: 'Geen certificaten vastgelegd.',
  certificatesAttachedNote: 'De PDF-certificaten zijn als bijlage achter dit dossier toegevoegd.',

  declarationAttached: 'De ondertekende verklaring is als bijlage achter dit dossier toegevoegd.',
  declarationMissing: 'Nog geen ondertekende verklaring beschikbaar.',
  auditHash: 'Audit-ID (SHA-256)',

  phases: {
    foundation: 'Fundering',
    shell: 'Ruwbouw',
    roof: 'Dak',
    finishing: 'Afbouw',
    handover: 'Oplevering',
    other: 'Overig',
  } as Record<string, string>,

  riskCategories: {
    structural_safety: 'Constructieve veiligheid',
    fire_safety: 'Brandveiligheid',
    health: 'Gezondheid',
    energy_efficiency: 'Energiezuinigheid',
    usability: 'Bruikbaarheid',
  } as Record<string, string>,

  riskLevels: {
    low: 'Laag',
    medium: 'Midden',
    high: 'Hoog',
  } as Record<string, string>,

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

  certTypes: {
    product: 'Productcertificaat',
    installation_test: 'Installatietestrapport',
    inspection: 'Inspectiecertificaat',
    warranty: 'Garantie',
    other: 'Overig',
  } as Record<string, string>,
} as const;

export type DossierLabels = {
  [K in keyof typeof NL_DOSSIER_LABELS]: (typeof NL_DOSSIER_LABELS)[K] extends Record<string, string>
    ? Record<string, string>
    : string;
};
