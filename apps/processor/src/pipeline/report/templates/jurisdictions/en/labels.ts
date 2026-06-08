/**
 * EN (English) labels for the Compliance Report PDF. Mirrors the Dutch labels
 * in `../nl/labels.ts` — same shape, same export type, just translated.
 */

import type { ComplianceReportLabels } from '../nl/labels.js';

export const EN_COMPLIANCE_LABELS: ComplianceReportLabels = {
  passed: 'Passed',
  failed: 'Failed',
  warned: 'Warning',
  totalRules: 'Total rules',
  totalChecks: 'Total checks',
  totalElements: 'Elements checked',
  rule: 'Rule',
  article: 'Article',
  category: 'Category',
  severity: 'Severity',
  status: 'Status',
  noResults: 'No check results available.',
  generatedAt: 'Generated at',
  project: 'Project',
  contractor: 'Contractor',
  address: 'Address',
  permit: 'Permit',
  delivery: 'Delivery date',
  reference: 'Project reference',
  framework: 'Framework',
  overallScore: 'Compliance',
  reportTitle: 'Compliance Report',
  sectionByCategory: 'By category',
  sectionByRule: 'By rule',
} as const;
