/**
 * EN (English) labels for the Dossier bevoegd gezag PDF (#33) — the full
 * evidence bundle. Mirrors `../nl/dossier-labels.ts` — same shape, translated.
 */

import type { DossierLabels } from '../nl/dossier-labels.js';

export const EN_DOSSIER_LABELS: DossierLabels = {
  reportTitle: 'Competent Authority Dossier',
  kicker: 'Quality Assurance for Building Act (Wkb)',
  reference: 'Project reference',
  address: 'Address',
  generatedAt: 'Generated at',
  toc: 'Table of Contents',

  sectionRisks: '1. Risk Assessment',
  sectionPlan: '2. Assurance Plan',
  sectionFindings: '3. Findings',
  sectionCertificates: '4. Certificates',
  sectionDeclaration: '5. Quality Assurance Declaration',

  category: 'Category',
  level: 'Risk level',
  riskDescription: 'Risk',
  mitigation: 'Mitigation',
  responsibleParty: 'Responsible party',
  article: 'Bbl article',
  noRisks: 'No risks recorded.',

  plannedDate: 'Planned',
  actualDate: 'Completed',
  noMoments: 'No assurance moments recorded.',

  severity: 'Severity',
  findingStatus: 'Status',
  resolution: 'Resolution',
  deadline: 'Deadline',
  noFindings: 'No findings recorded.',
  element: 'Element ID',
  location: 'Location',
  page: 'Page',

  certType: 'Type',
  certNumber: 'Number',
  issuer: 'Issuer',
  validUntil: 'Valid until',
  noCertificates: 'No certificates recorded.',
  certificatesAttachedNote: 'The PDF certificates are attached as appendices to this dossier.',

  declarationAttached: 'The signed declaration is attached as an appendix to this dossier.',
  declarationMissing: 'No signed declaration available yet.',
  auditHash: 'Audit ID (SHA-256)',

  phases: {
    foundation: 'Foundation',
    shell: 'Shell',
    roof: 'Roof',
    finishing: 'Finishing',
    handover: 'Handover',
    other: 'Other',
  } as Record<string, string>,

  riskCategories: {
    structural_safety: 'Structural safety',
    fire_safety: 'Fire safety',
    health: 'Health',
    energy_efficiency: 'Energy efficiency',
    usability: 'Usability',
  } as Record<string, string>,

  riskLevels: {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  } as Record<string, string>,

  findingSeverities: {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  } as Record<string, string>,

  findingStatuses: {
    draft: 'Draft',
    open: 'Open',
    in_progress: 'In progress',
    resolved: 'Resolved',
    verified: 'Verified',
  } as Record<string, string>,

  certTypes: {
    product: 'Product certificate',
    installation_test: 'Installation test report',
    inspection: 'Inspection certificate',
    warranty: 'Warranty',
    other: 'Other',
  } as Record<string, string>,
} as const;
