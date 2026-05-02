'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import type { CheckResultItem, RuleSummaryItem } from '@/lib/api/schemas';

const CATEGORY_LABELS: Record<string, string> = {
  fire_safety: 'Brandveiligheid',
  structural: 'Constructie',
  usability: 'Bruikbaarheid',
  health: 'Gezondheid',
  accessibility: 'Toegankelijkheid',
  sustainability: 'Duurzaamheid',
};

type FilterValue = 'all' | 'pass' | 'warn' | 'fail' | 'skip';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'fail', label: 'Fail' },
  { value: 'warn', label: 'Warn' },
  { value: 'pass', label: 'Pass' },
  { value: 'skip', label: 'Skip' },
];

type Props = {
  rules: RuleSummaryItem[];
  details: CheckResultItem[];
};

export function RulesBreakdown({ rules, details }: Props): JSX.Element {
  const [filter, setFilter] = useState<FilterValue>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const detailsByRule = useMemo(() => {
    const map = new Map<string, CheckResultItem[]>();
    for (const d of details) {
      const list = map.get(d.rule_id) ?? [];
      list.push(d);
      map.set(d.rule_id, list);
    }
    return map;
  }, [details]);

  const filteredRules = useMemo(() => {
    if (filter === 'all') return rules;
    return rules.filter((r) => {
      if (filter === 'pass') return r.passed > 0;
      if (filter === 'warn') return r.warned > 0;
      if (filter === 'fail') return r.failed > 0 || r.errors > 0;
      if (filter === 'skip') return r.skipped > 0;
      return true;
    });
  }, [rules, filter]);

  function toggle(ruleId: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
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
        <span className="text-caption text-foreground-tertiary">
          {filteredRules.length} of {rules.length} rules
        </span>
      </div>

      <div className="rounded-lg border border-border bg-background">
        {filteredRules.length === 0 ? (
          <div className="px-3 py-6 text-center text-body3 text-foreground-tertiary">
            No rules match this filter.
          </div>
        ) : (
          filteredRules.map((rule) => (
            <RuleRow
              key={rule.rule_id}
              rule={rule}
              isExpanded={expanded.has(rule.rule_id)}
              onToggle={() => { toggle(rule.rule_id); }}
              details={detailsByRule.get(rule.rule_id) ?? []}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  isExpanded,
  onToggle,
  details,
}: {
  rule: RuleSummaryItem;
  isExpanded: boolean;
  onToggle: () => void;
  details: CheckResultItem[];
}): JSX.Element {
  const fails = rule.failed + rule.errors;
  const dominantTone: 'success' | 'warning' | 'error' | 'default' =
    fails > 0 ? 'error' : rule.warned > 0 ? 'warning' : rule.passed > 0 ? 'success' : 'default';
  const categoryLabel = CATEGORY_LABELS[rule.category] ?? rule.category;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[20px_minmax(0,1fr)_88px_60px_60px_60px_60px] items-center gap-2 px-3 py-2 text-left text-body3 transition-colors hover:bg-background-hover"
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-foreground-tertiary" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-foreground-tertiary" />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-foreground">{rule.title_nl || rule.title}</span>
            <Badge variant={dominantTone === 'default' ? 'default' : dominantTone} className="shrink-0">
              {fails > 0 ? 'FAIL' : rule.warned > 0 ? 'WARN' : rule.passed > 0 ? 'PASS' : 'SKIP'}
            </Badge>
          </div>
          <div className="truncate font-mono text-caption text-foreground-tertiary">
            {rule.article} · {categoryLabel}
          </div>
        </div>
        <span className="text-right tabular-nums text-foreground-tertiary">
          {rule.total_checked} chk
        </span>
        <span className="text-right tabular-nums text-success">{rule.passed}</span>
        <span className="text-right tabular-nums text-warning">{rule.warned}</span>
        <span className="text-right tabular-nums text-error">{fails}</span>
        <span className="text-right tabular-nums text-foreground-tertiary">{rule.skipped}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-border bg-background-secondary/30 px-3 py-2">
          {details.length === 0 ? (
            <div className="py-2 text-caption text-foreground-tertiary">
              No element-level details recorded for this rule.
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {details.map((d, i) => (
                <DetailRow key={`${d.element_global_id}-${i}`} item={d} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function statusTone(status: CheckResultItem['status']): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'pass':
      return 'success';
    case 'warn':
      return 'warning';
    case 'fail':
    case 'error':
      return 'error';
    default:
      return 'default';
  }
}

function formatValue(v: CheckResultItem['actual_value']): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function DetailRow({ item }: { item: CheckResultItem }): JSX.Element {
  const tone = statusTone(item.status);
  const hasValues = item.actual_value !== null && item.actual_value !== undefined;
  return (
    <div className="grid grid-cols-[60px_minmax(0,1fr)_minmax(0,1.4fr)] items-start gap-3 py-2 text-body3">
      <Badge variant={tone === 'default' ? 'default' : tone} className="w-fit uppercase">
        {item.status}
      </Badge>
      <div className="min-w-0">
        <div className="truncate font-semibold">
          {item.element_name ?? item.element_global_id}
        </div>
        <div className="truncate font-mono text-caption text-foreground-tertiary">
          {item.element_type ?? '—'}
          {item.property_set !== null && item.property_set !== undefined ? ` · ${item.property_set}` : ''}
          {item.property_name !== null && item.property_name !== undefined ? `.${item.property_name}` : ''}
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-foreground">{item.message}</div>
        {hasValues && (
          <div className="mt-0.5 font-mono text-caption text-foreground-tertiary">
            actual: {formatValue(item.actual_value)} · expected: {formatValue(item.expected_value)}
          </div>
        )}
      </div>
    </div>
  );
}
