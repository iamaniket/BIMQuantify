'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { DrawingMetadata } from '@/lib/api/schemas/geometry';

type Props = {
  metadata: DrawingMetadata | undefined;
  isLoading: boolean;
};

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-caption font-medium uppercase tracking-wide text-foreground-tertiary">
        {label}
      </span>
      <span className="truncate text-body3 tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="border-b border-border px-3.5 py-3 last:border-b-0">
      <h3 className="mb-1.5 text-caption font-bold uppercase tracking-wider text-foreground-secondary">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function DrawingInfoBody({ metadata, isLoading }: Props): JSX.Element {
  const t = useTranslations('viewer.drawingInfo');

  if (isLoading) {
    return (
      <div className="p-3.5 text-body3 text-foreground-tertiary">{t('loading')}</div>
    );
  }
  if (metadata === undefined) {
    return (
      <div className="p-3.5 text-body3 text-foreground-tertiary">{t('noData')}</div>
    );
  }

  const dash = '—';
  const extents = metadata.extents;
  const size = extents !== null
    ? `${(extents.max[0] - extents.min[0]).toFixed(2)} × ${(extents.max[1] - extents.min[1]).toFixed(2)}`
    : dash;
  const entityRows = Object.entries(metadata.entityCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col">
      <Section title={t('overview')}>
        <Row label={t('source')} value={metadata.source.toUpperCase()} />
        <Row label={t('units')} value={metadata.units} />
        <Row label={t('version')} value={metadata.cadVersion ?? dash} />
        {metadata.savedBy !== null ? <Row label={t('savedBy')} value={metadata.savedBy} /> : null}
      </Section>

      <Section title={t('extents')}>
        {extents !== null ? (
          <>
            <Row label={t('min')} value={`${extents.min[0].toFixed(2)}, ${extents.min[1].toFixed(2)}`} />
            <Row label={t('max')} value={`${extents.max[0].toFixed(2)}, ${extents.max[1].toFixed(2)}`} />
            <Row label={t('size')} value={size} />
          </>
        ) : (
          <p className="text-body3 text-foreground-tertiary">{dash}</p>
        )}
      </Section>

      <Section title={t('layersTitle', { count: metadata.layers.length })}>
        {metadata.layers.length === 0 ? (
          <p className="text-body3 text-foreground-tertiary">{dash}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {metadata.layers.map((layer) => (
              <li key={layer.name} className="flex items-center gap-2 py-0.5">
                <span className="min-w-0 flex-1 truncate text-body3 text-foreground">{layer.name}</span>
                {layer.frozen ? (
                  <span className="rounded-sm bg-background-hover px-1 text-micro font-semibold uppercase text-foreground-tertiary">
                    {t('frozen')}
                  </span>
                ) : null}
                {layer.off ? (
                  <span className="rounded-sm bg-background-hover px-1 text-micro font-semibold uppercase text-foreground-tertiary">
                    {t('off')}
                  </span>
                ) : null}
                <span className="shrink-0 text-caption tabular-nums text-foreground-tertiary">
                  {layer.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('entitiesTitle')}>
        {entityRows.length === 0 ? (
          <p className="text-body3 text-foreground-tertiary">{dash}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {entityRows.map(([type, count]) => (
              <li key={type} className="flex items-center justify-between py-0.5">
                <span className="truncate text-body3 text-foreground">{type}</span>
                <span className="shrink-0 text-caption tabular-nums text-foreground-tertiary">
                  {count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
