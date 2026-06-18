'use client';

import { Box, Glasses, Moon, Sparkles, Sun, type AppIcon } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type JSX } from 'react';

import { cn } from '@bimstitch/ui';
import type { DisplayMode, ViewerHandle } from '@bimstitch/viewer';

import { ToolbarGroup } from '@/components/shared/viewer/shared/_toolbarPrimitives';

type Props = {
  handle: ViewerHandle | null;
  /** The live active mode (from the viewer's `display:change` event). */
  activeMode: DisplayMode;
  onSelect: (mode: DisplayMode) => void;
  onClose: () => void;
};

type ModeEntry = { mode: DisplayMode; icon: AppIcon };

// Order mirrors the plugin's cycle order. X-ray sits among the looks because the
// `display-mode` plugin presents one mutually-exclusive list (it delegates the
// x-ray entry to the existing xray plugin).
const ENTRIES: readonly ModeEntry[] = [
  { mode: 'normal', icon: Box },
  { mode: 'xray', icon: Glasses },
  { mode: 'monochrome', icon: Moon },
  { mode: 'clay', icon: Sun },
  { mode: 'matcap', icon: Sparkles },
];

/**
 * Toolbar flyout listing the five mutually-exclusive display modes. Selecting
 * one just calls `display.set` (via `onSelect`); the active highlight is driven by
 * the live `activeMode`. Closes on select (handled by the parent) or Esc — no
 * outside-click dismissal, matching the fly-nav popover.
 */
export function DisplayModePopover({ handle, activeMode, onSelect, onClose }: Props): JSX.Element {
  const t = useTranslations('viewer.displayMode');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onEsc = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('keydown', onEsc); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('label')}
      data-testid="viewer-display-mode-popover"
      className="absolute bottom-16 left-1/2 z-40 -translate-x-1/2"
    >
      <ToolbarGroup>
        <div className="flex w-full flex-col gap-0.5">
          {ENTRIES.map(({ mode, icon: Icon }) => {
            const active = activeMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={!handle}
                data-testid={`viewer-display-mode-${mode}`}
                onClick={() => { onSelect(mode); }}
                className={cn(
                  'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-body3 font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground/90',
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" weight="bold" />
                <span className="whitespace-nowrap">{t(mode)}</span>
              </button>
            );
          })}
        </div>
      </ToolbarGroup>
    </div>
  );
}
