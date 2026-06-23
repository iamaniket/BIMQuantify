/**
 * EN (English) labels for the per-recipient snag-list PDF (#G2). Mirror of
 * `NL_SNAG_LIST_LABELS` — same keys, English copy.
 */

import type { SnagListLabels } from '../nl/snag-list-labels.js';

export const EN_SNAG_LIST_LABELS: SnagListLabels = {
  reportTitle: 'Snag list',
  kicker: 'Dutch Building Quality Assurance Act (Wkb)',
  reference: 'Project reference',
  address: 'Address',
  recipient: 'Recipient',
  generatedAt: 'Generated on',
  scope: 'Selection',
  scopeAll: 'All findings',
  filterStatus: 'Status',
  filterSeverity: 'Severity',

  sectionFindings: 'Findings',
  severity: 'Severity',
  findingStatus: 'Status',
  assignee: 'Assigned to',
  deadline: 'Deadline',
  resolution: 'Resolution',
  element: 'Element ID',
  location: 'Location',
  page: 'Page',
  capturedAt: 'Captured',
  noFindings: 'No findings match this selection.',

  findingSeverities: {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  },

  findingStatuses: {
    draft: 'Draft',
    open: 'Open',
    in_progress: 'In progress',
    resolved: 'Resolved',
    verified: 'Verified',
  },
};
