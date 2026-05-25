'use client';

import { useState, type JSX } from 'react';

import { BlueprintTexture } from '@/components/shared/BlueprintTexture';
import { MOCK_ACTIVITY } from '@/features/compliance/mockData';
import type { ActivityItem } from '@/features/compliance/types';

type Filter = 'all' | 'scan' | 'upload' | 'fix';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'scan', label: 'Scans' },
  { key: 'upload', label: 'Uploads' },
  { key: 'fix', label: 'Fixes' },
];

function typeStyle(type: ActivityItem['type']): { bg: string; fg: string; glyph: string } {
  switch (type) {
    case 'upload': return { bg: 'rgba(44,86,151,0.10)', fg: 'var(--primary)', glyph: '↑' };
    case 'scan':   return { bg: 'rgba(95,217,158,0.18)', fg: 'var(--success)', glyph: '✓' };
    case 'fix':    return { bg: 'rgba(63,143,101,0.16)', fg: 'var(--success)', glyph: '⚒' };
    case 'pin':    return { bg: 'rgba(169,116,40,0.16)', fg: 'var(--warning)', glyph: '◉' };
    case 'report': return { bg: 'rgba(95,136,178,0.18)', fg: 'var(--info)', glyph: '⎙' };
    default:       return { bg: 'var(--surface-high)', fg: 'var(--fg-2)', glyph: '·' };
  }
}

export function ActivityPanel(): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');

  const all = MOCK_ACTIVITY;
  const counts = all.reduce<Record<string, number>>(
    (acc, a) => {
      acc[a.type] = (acc[a.type] ?? 0) + 1;
      acc['all'] = (acc['all'] ?? 0) + 1;
      return acc;
    },
    { all: 0 },
  );
  const filtered = filter === 'all' ? all : all.filter((a) => a.type === filter);

  const headings: Record<Filter, { eyebrow: string; title: string; sub: string }> = {
    all:    { eyebrow: 'Project activity', title: `${counts['all'] ?? 0} events`, sub: 'last 30 days' },
    scan:   { eyebrow: 'Scan activity',    title: `${counts['scan'] ?? 0} scans`,   sub: 'Bbl compliance runs' },
    upload: { eyebrow: 'Upload activity',  title: `${counts['upload'] ?? 0} uploads`, sub: 'IFC revisions submitted' },
    fix:    { eyebrow: 'Fix activity',     title: `${counts['fix'] ?? 0} fixes`,    sub: 'compliance corrections applied' },
  };
  const h = headings[filter];

  return (
    <div className="relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <BlueprintTexture />

      {/* Header — filter pill bar left, eyebrow/title right */}
      <div className="relative flex shrink-0 items-center gap-4 px-5 pb-2.5 pt-4">
        <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-surface-high p-[3px]">
          {FILTERS.map(({ key, label }) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setFilter(key); }}
                className={`rounded-[5px] px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'text-primary hover:bg-primary-light/60 dark:text-[#9bbce8]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto min-w-0 text-right">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
            {h.eyebrow}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline justify-end gap-2">
            <span className="font-display text-[17px] font-bold leading-tight tracking-tight text-foreground">
              {h.title}
            </span>
            <span className="text-[12.5px] font-medium text-foreground-tertiary">· {h.sub}</span>
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="relative flex-1 overflow-auto px-4 pb-3">
        {filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-body3 text-foreground-tertiary">
            No activity in this filter.
          </div>
        ) : (
          filtered.map((a) => {
            const s = typeStyle(a.type);
            return (
              <div
                key={a.id}
                className="flex gap-3 border-b border-dashed border-border py-2.5 last:border-b-0"
              >
                <div
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[12px] font-bold"
                  style={{ background: s.bg, color: s.fg }}
                >
                  {s.glyph}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] leading-tight text-foreground">
                    <span className="font-semibold">{a.actor}</span>{' '}
                    <span className="text-foreground-tertiary">· {a.description}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-foreground-tertiary">{a.detail}</div>
                </div>
                <div className="whitespace-nowrap text-[10.5px] text-foreground-tertiary">
                  {a.timestamp}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
