'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import { pickLocalized, type Locale } from '@bimstitch/i18n';
import { Badge } from '@bimstitch/ui';

import type { CheckResultItem, RuleSummaryItem } from '@/lib/api/schemas';

type FilterValue = 'all' | 'pass' | 'warn' | 'fail' | 'skip';

const FILTER_VALUES: FilterValue[] = ['all', 'fail', 'warn', 'pass', 'skip'];

type Props = {
  rules: RuleSummaryItem[];
  details: CheckResultItem[];
};

export function RulesBreakdown({ rules, details }: Props): JSX.Element {
  const locale = useLocale() as Locale;
  const t = useTranslations('reports.rulesBreakdown');
  const tCat = useTranslations('reports.categories');
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
          {FILTER_VALUES.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => { setFilter(f); }}
              className={`px-3 py-1 text-caption font-semibold transition-colors ${
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground-secondary hover:bg-background-hover'
              } ${f !== 'all' ? 'border-l border-border' : ''}`}
            >
              {t(`filters.${f}`)}
            </button>
          ))}
        </div>
        <span className="text-caption text-foreground-tertiary">
          {t('countSummary', { shown: filteredRules.length, total: rules.length })}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-background">
        {filteredRules.length === 0 ? (
          <div className="px-3 py-6 text-center text-body3 text-foreground-tertiary">
            {t('emptyFilter')}
          </div>
        ) : (
          filteredRules.map((rule) => (
            <RuleRow
              key={rule.rule_id}
              rule={rule}
              isExpanded={expanded.has(rule.rule_id)}
              onToggle={() => { toggle(rule.rule_id); }}
              details={detailsByRule.get(rule.rule_id) ?? []}
              locale={locale}
              t={t}
              tCat={tCat}
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
  locale,
  t,
  tCat,
}: {
  rule: RuleSummaryItem;
  isExpanded: boolean;
  onToggle: () => void;
  details: CheckResultItem[];
  locale: Locale;
  t: ReturnType<typeof useTranslations>;
  tCat: ReturnType<typeof useTranslations>;
}): JSX.Element {
  const fails = rule.failed + rule.errors;
  const dominantTone: 'success' | 'warning' | 'error' | 'default' =
    fails > 0 ? 'error' : rule.warned > 0 ? 'warning' : rule.passed > 0 ? 'success' : 'default';
  const categoryLabel = tCat.has(rule.category) ? tCat(rule.category) : rule.category;
  const ruleTitle = rule.titles !== undefined ? pickLocalized(rule.titles, locale) : (rule.title_nl ?? rule.title ?? '');

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
            <span className="truncate font-semibold text-foreground">{ruleTitle}</span>
            <Badge variant={dominantTone === 'default' ? 'default' : dominantTone} className="shrink-0">
              {fails > 0 ? t('badges.fail') : rule.warned > 0 ? t('badges.warn') : rule.passed > 0 ? t('badges.pass') : t('badges.skip')}
            </Badge>
          </div>
          <div className="truncate font-mono text-caption text-foreground-tertiary">
            {rule.article} · {categoryLabel}
          </div>
        </div>
        <span className="text-right tabular-nums text-foreground-tertiary">
          {rule.total_checked} {t('checkedShort')}
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
              {t('detail.noDetails')}
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
  const t = useTranslations('reports.rulesBreakdown.detail');
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
            {t('actualExpected', { actual: formatValue(item.actual_value), expected: formatValue(item.expected_value) })}
          </div>
        )}
      </div>
    </div>
  );
}
