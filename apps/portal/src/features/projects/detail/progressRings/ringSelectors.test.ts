import { describe, expect, it } from 'vitest';

import type { Deadline, Finding } from '@/lib/api/schemas';

import {
  findingEntityKind,
  isFindingComplete,
  ringPct,
  selectDeadlinesBreakdown,
  selectFindingsBreakdown,
  UNCATEGORIZED,
} from './ringSelectors';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: crypto.randomUUID(),
    project_id: '00000000-0000-0000-0000-000000000000',
    title: 'A finding',
    description: 'desc',
    severity: 'medium',
    status: 'open',
    assignee_user_id: null,
    deadline_date: null,
    bbl_article_ref: null,
    created_by_user_id: '00000000-0000-0000-0000-000000000001',
    source_checklist_item_id: null,
    borgingsmoment_id: null,
    linked_document_id: null,
    linked_file_id: null,
    linked_element_global_id: null,
    linked_file_type: null,
    anchor_x: null,
    anchor_y: null,
    anchor_z: null,
    anchor_page: null,
    photo_ids: null,
    resolution_note: null,
    resolution_evidence_ids: null,
    reference_attachment_ids: null,
    template_id: null,
    custom_values: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function deadline(overrides: Partial<Deadline> = {}): Deadline {
  return {
    id: crypto.randomUUID(),
    project_id: '00000000-0000-0000-0000-000000000000',
    deadline_type: 'bouwmelding',
    due_date: '2026-06-01',
    status: 'pending',
    met_at: null,
    met_by_user_id: null,
    reference_number: null,
    filing_notes: null,
    filed_at: null,
    is_overdue: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ringPct', () => {
  it('rounds the percentage', () => {
    expect(ringPct(1, 3)).toBe(33);
    expect(ringPct(2, 3)).toBe(67);
    expect(ringPct(5, 10)).toBe(50);
  });

  it('returns 0 (not 100) when total is 0 — avoids div-by-zero', () => {
    expect(ringPct(0, 0)).toBe(0);
  });

  it('handles a fully complete metric', () => {
    expect(ringPct(4, 4)).toBe(100);
  });
});

describe('isFindingComplete', () => {
  it('treats resolved and verified as complete, everything else as not', () => {
    expect(isFindingComplete(finding({ status: 'resolved' }))).toBe(true);
    expect(isFindingComplete(finding({ status: 'verified' }))).toBe(true);
    expect(isFindingComplete(finding({ status: 'draft' }))).toBe(false);
    expect(isFindingComplete(finding({ status: 'open' }))).toBe(false);
    expect(isFindingComplete(finding({ status: 'in_progress' }))).toBe(false);
  });
});

describe('findingEntityKind precedence', () => {
  it('prefers element over model and file', () => {
    expect(
      findingEntityKind(
        finding({
          linked_element_global_id: 'abc',
          linked_document_id: '00000000-0000-0000-0000-0000000000aa',
          linked_file_id: '00000000-0000-0000-0000-0000000000bb',
        }),
      ),
    ).toBe('element');
  });

  it('prefers model over file when no element', () => {
    expect(
      findingEntityKind(
        finding({
          linked_element_global_id: null,
          linked_document_id: '00000000-0000-0000-0000-0000000000aa',
          linked_file_id: '00000000-0000-0000-0000-0000000000bb',
        }),
      ),
    ).toBe('model');
  });

  it('uses file when only a file link', () => {
    expect(
      findingEntityKind(finding({ linked_file_id: '00000000-0000-0000-0000-0000000000bb' })),
    ).toBe('file');
  });

  it('falls back to unlinked', () => {
    expect(findingEntityKind(finding())).toBe('unlinked');
  });
});

describe('selectFindingsBreakdown', () => {
  it('counts complete = resolved + verified', () => {
    const b = selectFindingsBreakdown([
      finding({ status: 'resolved' }),
      finding({ status: 'verified' }),
      finding({ status: 'open' }),
      finding({ status: 'draft' }),
    ]);
    expect(b.total).toBe(4);
    expect(b.complete).toBe(2);
    expect(b.byStatus.resolved).toBe(1);
    expect(b.byStatus.verified).toBe(1);
    expect(b.byStatus.open).toBe(1);
    expect(b.byStatus.draft).toBe(1);
  });

  it('buckets severity and entity kind', () => {
    const b = selectFindingsBreakdown([
      finding({ severity: 'high', linked_element_global_id: 'e1' }),
      finding({ severity: 'high', linked_document_id: '00000000-0000-0000-0000-0000000000aa' }),
      finding({ severity: 'low' }),
    ]);
    expect(b.bySeverity).toEqual({ high: 2, medium: 0, low: 1 });
    expect(b.byEntityKind).toEqual({ element: 1, model: 1, file: 0, unlinked: 1 });
  });

  it('groups by article busiest-first and buckets nulls as uncategorized last', () => {
    const b = selectFindingsBreakdown([
      finding({ bbl_article_ref: 'BBL 4.21' }),
      finding({ bbl_article_ref: 'BBL 4.21' }),
      finding({ bbl_article_ref: 'BBL 2.84' }),
      finding({ bbl_article_ref: null }),
      finding({ bbl_article_ref: null }),
    ]);
    expect(b.byCategory[0]).toEqual({ ref: 'BBL 4.21', count: 2 });
    // BBL 2.84 (count 1) ties with uncategorized (count 2)? no — uncategorized
    // has 2, so it sorts by count: 4.21 (2), uncategorized (2), 2.84 (1). The
    // named article wins the tie against uncategorized.
    expect(b.byCategory.map((c) => c.ref)).toEqual(['BBL 4.21', UNCATEGORIZED, 'BBL 2.84']);
  });

  it('handles an empty project without throwing', () => {
    const b = selectFindingsBreakdown([]);
    expect(b.total).toBe(0);
    expect(b.complete).toBe(0);
    expect(b.byCategory).toEqual([]);
  });
});

describe('selectDeadlinesBreakdown', () => {
  it('buckets met / pending / overdue and excludes not_applicable', () => {
    const b = selectDeadlinesBreakdown([
      deadline({ status: 'met' }),
      deadline({ status: 'pending', is_overdue: false }),
      deadline({ status: 'pending', is_overdue: true }),
      deadline({ status: 'not_applicable' }),
    ]);
    expect(b).toEqual({ total: 3, met: 1, pending: 1, overdue: 1 });
  });

  it('returns zeros for no deadlines', () => {
    expect(selectDeadlinesBreakdown([])).toEqual({ total: 0, met: 0, pending: 0, overdue: 0 });
  });
});
