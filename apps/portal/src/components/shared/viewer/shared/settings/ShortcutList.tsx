'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Button, Eyebrow } from '@bimstitch/ui';

import { prettyKey } from './prettyKey';
import { CATEGORY_STYLES, CATEGORY_LABEL_KEYS } from './shortcutCategories';
import type { NormalizedBinding, ShortcutCategory } from './types';

const SHORTCUT_ORDER: { id: ShortcutCategory; subtitleKey: string }[] = [
  { id: 'global', subtitleKey: 'sectionGlobalSubtitle' },
  { id: 'editing', subtitleKey: 'sectionEditingSubtitle' },
  { id: 'navigation', subtitleKey: 'sectionNavigationSubtitle' },
  { id: 'modifier', subtitleKey: 'sectionModifierSubtitle' },
];

const PencilIcon = (): JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

type Props = {
  bindings: NormalizedBinding[];
  capturing: string | null;
  onCaptureStart: (command: string) => void;
  filter: ShortcutCategory | null;
  query: string;
  selected: string | null;
  onSelect: (command: string) => void;
};

export function ShortcutList({
  bindings, capturing, onCaptureStart, filter, query, selected, onSelect,
}: Props): JSX.Element {
  const t = useTranslations('viewer.shortcuts');
  const grouped = useMemo(() => {
    const out: Record<string, NormalizedBinding[]> = {};
    for (const sec of SHORTCUT_ORDER) out[sec.id] = [];
    for (const b of bindings) {
      if (filter && b.category !== filter) continue;
      if (query) {
        const q = query.toLowerCase();
        if (!b.label.toLowerCase().includes(q) && !b.combo.toLowerCase().includes(q)) continue;
      }
      out[b.category]?.push(b);
    }
    return out;
  }, [bindings, filter, query]);

  const hasAny = Object.values(grouped).some((rows) => rows.length > 0);

  if (!hasAny) {
    return (
      <p className="py-4 text-center text-body3 text-foreground-tertiary">
        {query ? t('noMatch') : t('noneRegistered')}
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="settings-shortcut-list">
      {SHORTCUT_ORDER.map((sec) => {
        const rows = grouped[sec.id];
        if (!rows || rows.length === 0) return null;
        const cat = CATEGORY_STYLES[sec.id];
        return (
          <div key={sec.id}>
            <div className="mb-2 flex items-baseline gap-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.swatch }} />
              <Eyebrow size="xs">
                {t(CATEGORY_LABEL_KEYS[sec.id])}
              </Eyebrow>
              <span className="text-caption text-foreground-tertiary">{t(sec.subtitleKey)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {rows.map((b) => {
                const isActive = selected === b.command;
                const isCapturing = capturing === b.command;
                const rowCat = CATEGORY_STYLES[b.category];
                return (
                  <div
                    key={b.command}
                    role="button"
                    tabIndex={0}
                    onClick={() => { onSelect(b.command); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') onSelect(b.command); }}
                    className={[
                      'flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors',
                      isActive
                        ? 'border-l-[3px] bg-surface-low'
                        : 'border-border bg-surface-main hover:bg-surface-low',
                    ].join(' ')}
                    style={isActive ? {
                      borderLeftColor: rowCat.swatch,
                      boxShadow: `0 0 0 1px ${rowCat.tint}`,
                    } : undefined}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: rowCat.swatch }} />
                      <div className="min-w-0">
                        <div className="truncate text-body3 font-semibold text-foreground">
                          {b.label}
                        </div>
                        <div className="font-sans text-caption text-foreground-tertiary">
                          {b.command}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <kbd
                        className={[
                          'inline-flex items-center justify-center rounded border px-1.5 py-0.5 font-sans text-caption font-semibold',
                          isCapturing
                            ? 'animate-pulse border-primary bg-primary-lighter text-primary'
                            : `${rowCat.bg} ${rowCat.border} ${rowCat.text}`,
                        ].join(' ')}
                      >
                        {isCapturing ? t('press') : prettyKey(b.combo)}
                      </kbd>
                      <Button
                        variant="ghost"
                        size="md"
                        className="!h-6 !w-6 !p-0"
                        onClick={(e) => { e.stopPropagation(); onCaptureStart(b.command); }}
                        aria-label={t('rebind')}
                      >
                        <PencilIcon />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
