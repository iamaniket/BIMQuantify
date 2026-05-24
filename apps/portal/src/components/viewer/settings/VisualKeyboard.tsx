'use client';

import { type JSX } from 'react';

import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@bimstitch/ui';

import {
  CATEGORY_LABELS,
  CATEGORY_STYLES,
  UNBOUND_STYLE,
  type CategoryStyle,
} from './shortcutCategories';
import { KEYBOARD_ROWS, codeToComboKey, type KeyDef } from './keyboardLayout';
import type { NormalizedBinding, ShortcutCategory } from './types';

type Props = {
  bindings: NormalizedBinding[];
  capturing: string | null;
  onCaptureStart: (command: string) => void;
};

function findBindingForKey(
  key: KeyDef,
  bindings: NormalizedBinding[],
): NormalizedBinding | null {
  if (key.isSpacer || !key.code) return null;
  const comboKey = codeToComboKey(key.code);
  return bindings.find((b) => {
    const parts = b.combo.split('+');
    const mainKey = parts[parts.length - 1];
    return mainKey === comboKey && parts.length === 1;
  }) ?? null;
}

function getKeyStyle(key: KeyDef, binding: NormalizedBinding | null): CategoryStyle {
  if (key.isModifier) return CATEGORY_STYLES.modifier;
  if (!binding) return UNBOUND_STYLE;
  return CATEGORY_STYLES[binding.category];
}

const KEY_UNIT = 36;
const KEY_GAP = 2;

export function VisualKeyboard({
  bindings,
  capturing,
  onCaptureStart,
}: Props): JSX.Element {
  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-3">
      <div className="flex flex-col items-center gap-[2px]">
        {KEYBOARD_ROWS.map((row, ri) => (
          <div key={String(ri)} className="flex gap-[2px]">
            {row.map((key, ki) => {
              if (key.isSpacer) {
                const sw = (key.width ?? 1);
                return (
                  <div
                    key={`spacer-${String(ri)}-${String(ki)}`}
                    style={{ width: sw * KEY_UNIT + (sw - 1) * KEY_GAP }}
                  />
                );
              }

              const binding = findBindingForKey(key, bindings);
              const style = getKeyStyle(key, binding);
              const isCapturing = capturing !== null
                && binding !== null
                && binding.command === capturing;
              const kw = (key.width ?? 1);
              const w = kw * KEY_UNIT + (kw - 1) * KEY_GAP;

              const keyButton = (
                <button
                  key={key.code || `${String(ri)}-${String(ki)}`}
                  type="button"
                  disabled={!binding && !key.isModifier}
                  onClick={() => {
                    if (binding) onCaptureStart(binding.command);
                  }}
                  className={[
                    'flex items-center justify-center rounded-sm border text-caption font-medium transition-all',
                    'h-[34px]',
                    style.bg,
                    style.border,
                    binding ? 'cursor-pointer hover:brightness-95' : 'cursor-default',
                    isCapturing ? 'ring-2 ring-primary ring-offset-1' : '',
                  ].join(' ')}
                  style={{ width: w, minWidth: w }}
                >
                  <span className={`select-none ${binding ? 'text-foreground' : 'text-foreground-tertiary'}`}>
                    {key.label}
                  </span>
                </button>
              );

              if (binding) {
                return (
                  <Tooltip key={key.code}>
                    <TooltipTrigger asChild>
                      {keyButton}
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {isCapturing ? 'Press a key…' : binding.label}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return keyButton;
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {(Object.keys(CATEGORY_LABELS) as ShortcutCategory[]).map((cat) => {
          const s = CATEGORY_STYLES[cat];
          return (
            <div key={cat} className="flex items-center gap-1.5">
              <div className={`h-3 w-3 rounded-xs border ${s.bg} ${s.border}`} />
              <span className="text-caption text-foreground-secondary">
                {CATEGORY_LABELS[cat]}
              </span>
            </div>
          );
        })}
        <div className="flex items-center gap-1.5">
          <div className={`h-3 w-3 rounded-xs border ${UNBOUND_STYLE.bg} ${UNBOUND_STYLE.border}`} />
          <span className="text-caption text-foreground-secondary">Unbound</span>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}
