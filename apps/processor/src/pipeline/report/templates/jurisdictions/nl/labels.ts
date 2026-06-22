/**
 * NL (Dutch) labels for the compliance report PDF.
 *
 * Moving the labels here makes the jurisdiction-pluggable architecture
 * concrete in the folder layout — adding DE / BE / FR is a sibling
 * directory with its own `labels.ts`. The template imports through a
 * registry; see `../index.ts`.
 */

export const NL_COMPLIANCE_LABELS = {
  passed: 'Geslaagd',
  failed: 'Mislukt',
  warned: 'Waarschuwing',
  totalRules: 'Totaal regels',
  totalChecks: 'Totaal controles',
  totalElements: 'Gecontroleerde elementen',
  rule: 'Regel',
  article: 'Artikel',
  category: 'Categorie',
  severity: 'Ernst',
  status: 'Status',
  noResults: 'Geen controleresultaten beschikbaar.',
  generatedAt: 'Gegenereerd op',
  project: 'Project',
  address: 'Adres',
  permit: 'Vergunning',
  delivery: 'Opleverdatum',
  reference: 'Projectkenmerk',
  framework: 'Kader',
  overallScore: 'Naleving',
  reportTitle: 'Nalevingsrapport',
  sectionByCategory: 'Per categorie',
  sectionByRule: 'Per regel',
} as const;

export type ComplianceReportLabels = { [K in keyof typeof NL_COMPLIANCE_LABELS]: string };
