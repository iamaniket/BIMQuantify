'use client';

import { useTranslations } from 'next-intl';
import {
  type JSX, type ReactNode, useCallback, useRef, useState,
} from 'react';

import { cn, Eyebrow } from '@bimstitch/ui';

import type { PanelId } from '@/components/shared/viewer/shared/SideRail';

export type { PanelId } from '@/components/shared/viewer/shared/SideRail';

const PANEL_TITLE_KEYS: Record<PanelId, string> = {
  explorer: 'titleExplorer',
  findings: 'titleFindings',
  measure: 'titleMeasure',
  section: 'titleSection',
  drawingInfo: 'titleDrawingInfo',
  bcf: 'titleBcf',
};

type SidePanelProps = {
  activePanel: PanelId | null;
  explorerContent?: ReactNode | undefined;
  findingsContent?: ReactNode | undefined;
  measureContent?: ReactNode | undefined;
  sectionContent?: ReactNode | undefined;
  drawingInfoContent?: ReactNode | undefined;
  bcfContent?: ReactNode | undefined;
  headerActions?: Partial<Record<PanelId, ReactNode>> | undefined;
  headerExpanded?: boolean | undefined;
  onHeaderToggle?: (() => void) | undefined;
};

function PlaceholderContent({ label }: { label: string }): JSX.Element {
  const t = useTranslations('viewer.sidePanel');
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="text-center">
        <p className="text-body2 font-medium text-foreground-secondary">{label}</p>
        <p className="mt-1 font-sans text-caption text-foreground-secondary/60">
          {t('comingSoon')}
        </p>
      </div>
    </div>
  );
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 360;

export function SidePanel({
  activePanel,
  explorerContent,
  findingsContent,
  measureContent,
  sectionContent,
  drawingInfoContent,
  bcfContent,
  headerActions,
  headerExpanded,
  onHeaderToggle,
}: SidePanelProps): JSX.Element {
  const t = useTranslations('viewer.sidePanel');
  const isOpen = activePanel !== null;
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onPointerMove = (ev: PointerEvent): void => {
      if (!dragging.current) return;
      const delta = startX - ev.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
      setWidth(next);
    };

    const onPointerUp = (): void => {
      dragging.current = false;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [width]);

  return (
    <div
      aria-hidden={!isOpen}
      // Stable hook for the viewer's guided-pick overlay (`interaction.request`
      // blockedSelectors): the scrim re-covers this panel so it's dimmed + inert
      // while the user picks a point/element in the model.
      data-pick-block=""
      style={{ width: isOpen ? width : DEFAULT_WIDTH }}
      className={cn(
        'absolute bottom-0 right-0 top-0 z-20 transition-transform duration-200 ease-out',
        isOpen
          ? 'pointer-events-auto translate-x-0'
          : 'pointer-events-none translate-x-full',
      )}
    >
      {/* Resize handle */}
      <div
        onPointerDown={onPointerDown}
        className="absolute -left-1 top-0 bottom-0 z-10 w-2 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors"
      />
      <div className="flex h-full flex-col border-l border-border bg-background shadow-lg">
        {activePanel !== null && (
          <>
            {onHeaderToggle ? (
              <div
                className="flex h-10 w-full shrink-0 select-none items-center gap-2 border-b border-border px-3.5"
                style={{
                  background: 'linear-gradient(135deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)',
                }}
              >
                <button
                  type="button"
                  onClick={onHeaderToggle}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left transition-colors hover:brightness-110"
                >
                  <span
                    aria-hidden="true"
                    className="inline-grid h-3.5 w-3.5 shrink-0 place-items-center text-white/70 transition-transform duration-[120ms]"
                    style={{ transform: headerExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 8 8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="2.5,1.5 5.5,4 2.5,6.5" />
                    </svg>
                  </span>
                  <Eyebrow as="span" tone="tertiary" className="flex-1 text-white">
                    {t(PANEL_TITLE_KEYS[activePanel])}
                  </Eyebrow>
                </button>
                {headerActions?.[activePanel] && (
                  <div className="flex items-center gap-0.5">
                    {headerActions[activePanel]}
                  </div>
                )}
              </div>
            ) : (
              <div
                className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3.5"
                style={{
                  background: 'linear-gradient(135deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)',
                }}
              >
                <Eyebrow as="span" tone="tertiary" className="text-white">
                  {t(PANEL_TITLE_KEYS[activePanel])}
                </Eyebrow>
                {headerActions?.[activePanel] && (
                  <div className="flex items-center gap-0.5">
                    {headerActions[activePanel]}
                  </div>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {activePanel === 'explorer' && explorerContent}
              {activePanel === 'findings' && (findingsContent ?? <PlaceholderContent label={t('titleFindings')} />)}
              {activePanel === 'measure' && measureContent}
              {activePanel === 'section' && sectionContent}
              {activePanel === 'drawingInfo' && drawingInfoContent}
              {activePanel === 'bcf' && bcfContent}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
