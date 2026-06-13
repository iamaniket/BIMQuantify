'use client';

import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Badge, type BadgeVariant, Eyebrow } from '@bimstitch/ui';
import type { ViewerHandle } from '@bimstitch/viewer';

import type { ProjectViewerModelEntry } from '@/lib/api/schemas';

import { federatedModelId } from './federatedModelId';

type Props = {
  handle: ViewerHandle | null;
  models: ProjectViewerModelEntry[];
  viewerReady: boolean;
};

// Content classification → badge tone. Architectural is the plan source, so it
// reads as primary; the rest get distinct tones for quick scanning.
const KIND_VARIANT: Record<string, BadgeVariant> = {
  architectural: 'primary',
  structural: 'info',
  mep: 'warning',
  mixed: 'success',
  none: 'default',
};

/**
 * Floating layer panel for the federated viewer: one row per discipline model
 * with a visibility checkbox (drives the core `model:setVisible` command) and a
 * content-classification badge. Self-contained — no SideRail/store coupling.
 */
export function ModelLayersPanel({ handle, models, viewerReady }: Props): JSX.Element | null {
  const t = useTranslations('viewer.federated');
  // Hidden models, keyed by file_id. Defaults to all-visible.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  if (models.length === 0) return null;

  const toggle = (entry: ProjectViewerModelEntry): void => {
    const willHide = !hidden.has(entry.file_id);
    const next = new Set(hidden);
    if (willHide) next.add(entry.file_id);
    else next.delete(entry.file_id);
    setHidden(next);
    void handle?.commands
      .execute('model:setVisible', {
        modelId: federatedModelId(entry.file_id),
        visible: !willHide,
      })
      .catch(() => undefined);
  };

  const kindLabel = (entry: ProjectViewerModelEntry): string => {
    const kind = entry.detected_kind;
    return kind ? t(`kind.${kind}`) : t('kind.unknown');
  };

  return (
    <div className="absolute left-3 top-3 z-30 w-56 overflow-hidden rounded-md border border-border bg-surface-low/95 shadow-md backdrop-blur-sm">
      <div className="border-b border-border px-3 py-2">
        <Eyebrow>{t('layersTitle')}</Eyebrow>
      </div>
      <ul className="max-h-[50vh] overflow-y-auto py-1">
        {models.map((entry) => {
          const isVisible = !hidden.has(entry.file_id);
          return (
            <li key={entry.file_id}>
              <label
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-background-hover"
                title={entry.model_name}
              >
                <input
                  type="checkbox"
                  checked={isVisible}
                  disabled={!viewerReady}
                  onChange={() => toggle(entry)}
                  className="h-3.5 w-3.5 shrink-0 accent-primary"
                />
                <span className="min-w-0 flex-1 truncate text-body3 text-foreground">
                  {entry.model_name}
                </span>
                <Badge
                  size="sm"
                  variant={KIND_VARIANT[entry.detected_kind ?? 'none'] ?? 'default'}
                >
                  {kindLabel(entry)}
                </Badge>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
