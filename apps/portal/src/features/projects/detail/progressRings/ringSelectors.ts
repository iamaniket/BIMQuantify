import type {
  Deadline,
  Finding,
  FindingSeverityValue,
  FindingStatusValue,
} from '@/lib/api/schemas';

/**
 * Pure selectors that turn the project's already-fetched findings and deadlines
 * into the numbers the completeness rings (and their expanded pie breakdowns)
 * render. No React, no I/O — unit-testable, mirroring `computeDossierCompleteness`.
 */

/** Percentage with a single div-by-zero guard. `total === 0` → 0 (not 100). */
export function ringPct(filled: number, total: number): number {
  return total > 0 ? Math.round((filled / total) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/** A finding is "complete" once it is resolved or verified — the exact inverse
 * of the page's `findingsOpen` count, so the ring and the KPIs never disagree. */
export function isFindingComplete(f: Finding): boolean {
  return f.status === 'resolved' || f.status === 'verified';
}

/** Which kind of thing a finding is anchored to. Element-anchored findings also
 * carry their model/file links as provenance, so the ladder checks the most
 * specific link first. */
type FindingEntityKind = 'element' | 'model' | 'file' | 'unlinked';

export function findingEntityKind(f: Finding): FindingEntityKind {
  if (f.linked_element_global_id !== null) return 'element';
  if (f.linked_model_id !== null) return 'model';
  if (f.linked_file_id !== null) return 'file';
  return 'unlinked';
}

/** Sentinel category key for findings with no `bbl_article_ref`. */
export const UNCATEGORIZED = '__uncategorized__';

type CategoryCount = { ref: string; count: number };

type FindingsBreakdown = {
  total: number;
  /** resolved + verified. */
  complete: number;
  byStatus: Record<FindingStatusValue, number>;
  bySeverity: Record<FindingSeverityValue, number>;
  /** Grouped on `bbl_article_ref`, busiest first; null → `UNCATEGORIZED` bucket. */
  byCategory: CategoryCount[];
  byEntityKind: Record<FindingEntityKind, number>;
};

export function selectFindingsBreakdown(findings: Finding[]): FindingsBreakdown {
  const byStatus: Record<FindingStatusValue, number> = {
    draft: 0,
    open: 0,
    in_progress: 0,
    resolved: 0,
    verified: 0,
  };
  const bySeverity: Record<FindingSeverityValue, number> = { high: 0, medium: 0, low: 0 };
  const byEntityKind: Record<FindingEntityKind, number> = {
    element: 0,
    model: 0,
    file: 0,
    unlinked: 0,
  };
  const categoryMap = new Map<string, number>();

  let complete = 0;
  for (const f of findings) {
    byStatus[f.status] += 1;
    bySeverity[f.severity] += 1;
    byEntityKind[findingEntityKind(f)] += 1;
    if (isFindingComplete(f)) complete += 1;

    const ref = f.bbl_article_ref ?? UNCATEGORIZED;
    categoryMap.set(ref, (categoryMap.get(ref) ?? 0) + 1);
  }

  const byCategory = Array.from(categoryMap.entries())
    .map(([ref, count]) => ({ ref, count }))
    // Busiest first; ties broken by ref for a stable order. The uncategorized
    // bucket sorts last among equal counts so a named article wins a tie.
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.ref === UNCATEGORIZED) return 1;
      if (b.ref === UNCATEGORIZED) return -1;
      return a.ref < b.ref ? -1 : 1;
    });

  return {
    total: findings.length,
    complete,
    byStatus,
    bySeverity,
    byCategory,
    byEntityKind,
  };
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

type DeadlinesBreakdown = {
  /** Excludes `not_applicable` — those are not part of the obligation. */
  total: number;
  met: number;
  pending: number;
  overdue: number;
};

export function selectDeadlinesBreakdown(deadlines: Deadline[]): DeadlinesBreakdown {
  let met = 0;
  let overdue = 0;
  let pending = 0;
  let total = 0;
  for (const d of deadlines) {
    if (d.status === 'not_applicable') continue;
    total += 1;
    if (d.status === 'met') met += 1;
    else if (d.is_overdue) overdue += 1;
    else pending += 1;
  }
  return { total, met, pending, overdue };
}
