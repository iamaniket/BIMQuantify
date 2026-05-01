'use client';

import { Search } from 'lucide-react';
import { useState, useMemo, type JSX } from 'react';

import { Badge, Input } from '@bimstitch/ui';

import type { ComplianceIssue } from '@/features/projects/compliance/types';

import { IssueDetailModal } from './IssueDetailModal';

type Props = {
  issues: ComplianceIssue[];
};

const DISC_COLORS: Record<string, { bg: string; fg: string }> = {
  FIRE: { bg: '#fde2e2', fg: '#b91c1c' },
  ARCH: { bg: '#ede8f7', fg: '#5a3fa6' },
  STR: { bg: '#e5edf7', fg: '#2c5697' },
  MEP: { bg: '#f8ecd9', fg: '#a97428' },
  ACC: { bg: '#eaf6ef', fg: '#3f8f65' },
  ENV: { bg: '#e0f2fe', fg: '#0369a1' },
};

type FilterValue = 'all' | 'fail' | 'warn';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'fail', label: 'Fail' },
  { value: 'warn', label: 'Warn' },
];

export function IssuesTab({ issues }: Props): JSX.Element {
  const [filter, setFilter] = useState<FilterValue>('all');
  const [search, setSearch] = useState('');
  const [selectedIssue, setSelectedIssue] = useState<ComplianceIssue | null>(null);

  const filtered = useMemo(() => {
    let result = issues;
    if (filter !== 'all') {
      result = result.filter((i) => i.severity === filter);
    }
    if (search.length > 0) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.id.toLowerCase().includes(q) ||
          i.bblCode.toLowerCase().includes(q) ||
          i.objectName.toLowerCase().includes(q) ||
          i.owner.toLowerCase().includes(q),
      );
    }
    return result;
  }, [issues, filter, search]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex rounded-md border border-border">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => { setFilter(f.value); }}
              className={`px-3 py-1 text-caption font-semibold transition-colors ${
                filter === f.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground-secondary hover:bg-background-hover'
              } ${f.value !== 'all' ? 'border-l border-border' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-tertiary" />
          <Input
            inputSize="sm"
            placeholder="Search issues…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="pl-8"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background">
        <div className="grid grid-cols-[50px_80px_1fr_80px_80px_60px] items-center px-3 py-2 text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
          <span>Sev.</span>
          <span>ID</span>
          <span>Object</span>
          <span>Location</span>
          <span>Model</span>
          <span>Age</span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-body3 text-foreground-tertiary">
            No issues match your filter.
          </div>
        ) : (
          filtered.map((issue) => {
            const colors = DISC_COLORS[issue.modelDiscipline] ?? { bg: '#f1f3f6', fg: '#4b5563' };
            return (
              <div
                key={issue.id}
                onClick={() => { setSelectedIssue(issue); }}
                className="grid cursor-pointer grid-cols-[50px_80px_1fr_80px_80px_60px] items-center border-t border-border px-3 py-2 text-body3 transition-colors hover:bg-background-hover"
              >
                <Badge variant={issue.severity === 'fail' ? 'error' : 'warning'} className="w-fit">
                  {issue.severity === 'fail' ? 'FAIL' : 'WARN'}
                </Badge>
                <span className="font-mono font-bold text-foreground">{issue.id}</span>
                <div className="min-w-0">
                  <span className="truncate font-medium text-foreground">{issue.objectName}</span>
                  <span className="ml-1.5 text-caption text-foreground-tertiary">{issue.bblCode}</span>
                </div>
                <span className="text-caption text-foreground-tertiary">{issue.location}</span>
                <span
                  className="w-fit rounded-sm px-1 py-px text-[9.5px] font-bold"
                  style={{ background: colors.bg, color: colors.fg }}
                >
                  {issue.modelDiscipline}
                </span>
                <span className="text-caption text-foreground-tertiary">{issue.createdAt}</span>
              </div>
            );
          })
        )}
      </div>

      <IssueDetailModal
        issue={selectedIssue}
        open={selectedIssue !== null}
        onOpenChange={(open) => { if (!open) setSelectedIssue(null); }}
      />
    </div>
  );
}
