'use client';

import { AlertTriangle, ChevronDown, ChevronRight } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import type { ModelMetadata } from '@/lib/api/viewerTypes';

import { useOrphanedElementItems } from './useOrphanedElementItems';

type Props = {
  projectId: string;
  modelId: string;
  metadata: ModelMetadata | undefined;
};

type OrphanRow = {
  key: string;
  kind: string;
  label: string;
};

/**
 * Compact banner shown in the inspector when viewing a model version that is
 * missing elements other versions linked findings to. Lists findings whose
 * GlobalId is absent here so they don't silently vanish.
 */
export function OrphanedItemsNotice({ projectId, modelId, metadata }: Props): JSX.Element | null {
  const t = useTranslations('viewerOrphans');
  const [expanded, setExpanded] = useState(false);
  const { findings, total, ready } = useOrphanedElementItems(
    projectId,
    modelId,
    metadata,
  );

  if (!ready || total === 0) return null;

  const rows: OrphanRow[] = [
    ...findings.map((f) => ({ key: `f-${f.id}`, kind: t('kindFinding'), label: f.title })),
  ];

  return (
    <div className="border-b border-border bg-warning-lighter">
      <button
        type="button"
        onClick={() => { setExpanded((prev) => !prev); }}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
        aria-expanded={expanded}
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-body3 font-medium text-foreground">{t('title')}</p>
          <p className="text-caption text-foreground-secondary">{t('summary', { count: total })}</p>
        </div>
        {expanded ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
        )}
      </button>
      {expanded ? (
        <ul className="border-t border-border px-2.5 py-1">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2 py-1">
              <Badge variant="warning" className="shrink-0">
                {r.kind}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-body3 text-foreground" title={r.label}>
                {r.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
