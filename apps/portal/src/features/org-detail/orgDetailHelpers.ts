import type { AuditEntry } from '@/lib/api/schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function orgInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export const AUDIT_PAGE_SIZE = 50;
// Pull a generous window from the server; the footer paginates it client-side.
export const AUDIT_FETCH_LIMIT = 500;

export function computeSince(filter: string): string | undefined {
  if (filter === 'all') return undefined;
  const now = new Date();
  if (filter === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  const days = parseInt(filter, 10);
  if (isNaN(days)) return undefined;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function matchesActionFilter(action: string, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'auth') return action.startsWith('auth.');
  if (filter === 'member')
    return action.startsWith('organization_member.') || action.startsWith('member.');
  if (filter === 'settings')
    return action.startsWith('organization.') && !action.startsWith('organization_member.');
  return true;
}

function summarizeCsv(entry: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }): string {
  const before = entry.before === null ? null : JSON.stringify(entry.before);
  const after = entry.after === null ? null : JSON.stringify(entry.after);
  if (before !== null && after !== null) return `${before} → ${after}`;
  if (after !== null) return after;
  if (before !== null) return before;
  return '';
}

export function exportAuditCsv(entries: AuditEntry[]): void {
  const header = 'Timestamp,Action,Resource Type,Resource ID,Change';
  const rows = entries.map((e) => {
    const ts = new Date(e.created_at).toISOString();
    const change = summarizeCsv(e).replace(/"/g, '""');
    const resId = e.resource_id ?? '';
    return `"${ts}","${e.action}","${e.resource_type}","${resId}","${change}"`;
  });
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// `justNowLabel` is localized by the caller (pass `useTranslations('orgDetail.relativeTime')('justNow')`).
// The m/h/d units are language-neutral abbreviations and stay inline.
export function relativeTime(dateStr: string, justNowLabel: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return justNowLabel;
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export const IMAGE_ALLOWED_TYPES = 'image/png,image/jpeg,image/webp';
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
