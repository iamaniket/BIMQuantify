/**
 * EN (English) labels for the Assurance Plan (Borgingsplan) PDF (#31). Mirrors
 * `../nl/assurance-plan-labels.ts` — same shape, translated.
 */

import type { AssurancePlanLabels } from '../nl/assurance-plan-labels.js';

export const EN_ASSURANCE_PLAN_LABELS: AssurancePlanLabels = {
  reportTitle: 'Assurance Plan',
  reference: 'Project reference',
  address: 'Address',
  kwaliteitsborger: 'Quality assurance inspector',
  version: 'Version',
  status: 'Status',
  generatedAt: 'Generated at',

  sectionRisks: 'Risk Assessment',
  sectionMoments: 'Assurance Moments',

  category: 'Category',
  level: 'Risk level',
  riskDescription: 'Risk',
  mitigation: 'Mitigation',
  responsibleParty: 'Responsible party',
  article: 'Bbl article',
  noRisks: 'No risks recorded.',

  noMoments: 'No assurance moments recorded.',
  plannedDate: 'Planned',
  actualDate: 'Completed',
  responsible: 'Responsible',
  evidence: 'Evidence',
  criteria: 'Criterion',
  checklistItem: 'Check item',

  signatureTitle: 'Quality assurance inspector signature',
  signatureName: 'Name',
  signatureSignature: 'Signature',
  signatureDate: 'Date',

  planStatus: {
    draft: 'Draft',
    published: 'Published',
    superseded: 'Superseded',
  } as Record<string, string>,

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

  evidenceTypes: {
    photo: 'Photo',
    certificate: 'Certificate',
    measurement: 'Measurement',
    document: 'Document',
    signature: 'Signature',
  } as Record<string, string>,
} as const;
