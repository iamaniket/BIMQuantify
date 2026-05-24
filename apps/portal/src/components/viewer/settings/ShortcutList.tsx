'use client';

import { type JSX } from 'react';

import { CATEGORY_STYLES } from './shortcutCategories';
import type { NormalizedBinding } from './types';

type Props = {
  bindings: NormalizedBinding[];
  capturing: string | null;
  onCaptureStart: (command: string) => void;
};

export function ShortcutList({
  bindings,
  capturing,
  onCaptureStart,
}: Props): JSX.Element {
  if (bindings.length === 0) {
    return (
      <p className="text-body3 text-foreground-secondary">No shortcuts registered.</p>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
        All shortcuts
      </h4>
      <ul
        className="max-h-48 space-y-0.5 overflow-y-auto"
        data-testid="settings-shortcut-list"
      >
        {bindings.map((b) => {
          const isCapturing = capturing === b.command;
          const style = CATEGORY_STYLES[b.category];
          return (
            <li
              key={b.command}
              className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-background-secondary"
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className={`h-2 w-2 shrink-0 rounded-full ${style.bg} border ${style.border}`} />
                <span className="truncate text-body3 text-foreground">
                  {b.label}
                </span>
              </div>
              <button
                type="button"
                onClick={() => { onCaptureStart(b.command); }}
                className={[
                  'shrink-0 rounded border px-2 py-0.5 font-mono text-caption transition-colors',
                  isCapturing
                    ? 'border-primary bg-primary-lighter text-primary'
                    : 'border-border bg-background text-foreground hover:bg-background-secondary',
                ].join(' ')}
              >
                {isCapturing ? 'Press a key…' : b.combo || '—'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
