'use client';

import { ArrowRight, MapPin } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import { Link } from '@/i18n/navigation';
import { useModels } from '@/features/models/useModels';
import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { severityBadgeVariant, statusBadgeVariant } from '@/features/projects/detail/findingBadges';
import type { Finding } from '@/lib/api/schemas';

type Props = {
  projectId: string;
  findings: Finding[];
};

/** A finding can be opened at its location only when both a model and a file are linked. */
function isPlaced(f: Finding): boolean {
  return f.linked_model_id !== null && f.linked_file_id !== null;
}

function locationSummary(f: Finding): string | null {
  if (f.linked_element_global_id !== null) return f.linked_element_global_id;
  if (f.anchor_page !== null) return `p. ${String(f.anchor_page)}`;
  return null;
}

export function FindingsLocationsTab({ projectId, findings }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.locations');
  const tStatus = useTranslations('findingsBoard.columns');
  const tSeverity = useTranslations('findings.severity');
  const modelsQuery = useModels(projectId);
  const [selected, setSelected] = useState<Finding | null>(null);

  const modelName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of modelsQuery.data ?? []) map.set(m.id, m.name);
    return map;
  }, [modelsQuery.data]);

  // Group placed findings by model; everything else falls into the unplaced bucket.
  const { groups, unplaced } = useMemo(() => {
    const byModel = new Map<string, Finding[]>();
    const rest: Finding[] = [];
    for (const f of findings) {
      if (isPlaced(f)) {
        const key = f.linked_model_id!;
        const list = byModel.get(key) ?? [];
        list.push(f);
        byModel.set(key, list);
      } else {
        rest.push(f);
      }
    }
    return {
      groups: Array.from(byModel.entries()).map(([modelId, items]) => ({ modelId, items })),
      unplaced: rest,
    };
  }, [findings]);

  const renderMeta = (f: Finding): JSX.Element => (
    <>
      <Badge variant={severityBadgeVariant(f.severity)} size="md" bordered>
        {tSeverity(f.severity)}
      </Badge>
      <Badge variant={statusBadgeVariant(f.status)} size="md">
        {tStatus(f.status)}
      </Badge>
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ modelId, items }) => (
        <div key={modelId} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-foreground-tertiary" aria-hidden />
            <h3 className="text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
              {modelName.get(modelId) ?? t('noModel')}
            </h3>
            <span className="text-body3 tabular-nums text-foreground-tertiary">{items.length}</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {items.map((f) => {
              const summary = locationSummary(f);
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => { setSelected(f); }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="min-w-0 truncate text-body3 font-medium text-foreground">{f.title}</span>
                    {summary !== null && (
                      <span className="shrink-0 truncate font-sans text-[11px] tabular-nums text-foreground-tertiary">
                        {summary}
                      </span>
                    )}
                  </button>
                  {renderMeta(f)}
                  <Link
                    href={`/projects/${projectId}/models/${f.linked_model_id!}/viewer/${f.linked_file_id!}?finding=${f.id}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-foreground-secondary transition-colors hover:bg-background-hover hover:text-foreground"
                  >
                    {t('viewInModel')}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {unplaced.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
              {t('unplaced')}
            </h3>
            <span className="text-body3 tabular-nums text-foreground-tertiary">{unplaced.length}</span>
          </div>
          <p className="text-body3 text-foreground-tertiary">{t('openToPinHint')}</p>
          <ul className="flex flex-col gap-1.5">
            {unplaced.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => { setSelected(f); }}
                  className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-background-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-body3 font-medium text-foreground">{f.title}</span>
                  {renderMeta(f)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {findings.length === 0 && (
        <p className="py-8 text-center text-body3 text-foreground-tertiary">{t('empty')}</p>
      )}

      <FindingDetailModal
        projectId={projectId}
        finding={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}
