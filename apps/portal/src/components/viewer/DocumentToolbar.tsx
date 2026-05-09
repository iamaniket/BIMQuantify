'use client';

import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent, type JSX } from 'react';

import { cn } from '@bimstitch/ui';

type Props = {
  currentPage: number;
  numPages: number | null;
  scale: number;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

function clampPage(value: number, max: number | null): number {
  if (max === null) return Math.max(1, value);
  return Math.min(Math.max(1, value), max);
}

export function DocumentToolbar({
  currentPage,
  numPages,
  scale,
  onPageChange,
  onScaleChange,
}: Props): JSX.Element {
  const [pageInput, setPageInput] = useState(String(currentPage));

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const handlePageSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isFinite(parsed)) {
      onPageChange(clampPage(parsed, numPages));
    } else {
      setPageInput(String(currentPage));
    }
  };

  const canPrev = currentPage > 1;
  const canNext = numPages === null ? false : currentPage < numPages;

  const buttonCls = (disabled: boolean): string =>
    cn(
      'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 ease-out',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      disabled
        ? 'cursor-not-allowed text-foreground/20'
        : 'text-foreground/55 shadow-[inset_0_0_0_1px_var(--border),0_1px_2px_rgba(0,0,0,0.04)] hover:bg-foreground/[0.06] hover:text-foreground/90 active:scale-[0.94]',
    );

  return (
    <div
      className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2"
      data-testid="document-toolbar"
    >
      <div className="flex items-center rounded-xl border border-border bg-white/95 px-1 py-0.5 shadow-[0_8px_32px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/[0.08] dark:bg-[rgba(15,15,20,0.75)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-0.5 px-0.5 py-0.5">
          <button
            type="button"
            onClick={() => { onScaleChange(Math.max(MIN_SCALE, scale - SCALE_STEP)); }}
            title="Zoom out"
            aria-label="Zoom out"
            disabled={scale <= MIN_SCALE}
            className={buttonCls(scale <= MIN_SCALE)}
          >
            <Minus className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <span className="min-w-[44px] px-1 text-center text-caption font-semibold tabular-nums text-foreground/80">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => { onScaleChange(Math.min(MAX_SCALE, scale + SCALE_STEP)); }}
            title="Zoom in"
            aria-label="Zoom in"
            disabled={scale >= MAX_SCALE}
            className={buttonCls(scale >= MAX_SCALE)}
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="mx-0.5 h-4 w-px rounded-full bg-black/[0.08] dark:bg-white/[0.07]" />

        <div className="flex items-center gap-0.5 px-0.5 py-0.5">
          <button
            type="button"
            onClick={() => { onPageChange(clampPage(currentPage - 1, numPages)); }}
            title="Previous page"
            aria-label="Previous page"
            disabled={!canPrev}
            className={buttonCls(!canPrev)}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <form onSubmit={handlePageSubmit} className="flex items-center gap-1 px-1">
            <input
              type="text"
              inputMode="numeric"
              value={pageInput}
              onChange={(e) => { setPageInput(e.target.value); }}
              onBlur={() => {
                const parsed = Number.parseInt(pageInput, 10);
                if (Number.isFinite(parsed)) {
                  onPageChange(clampPage(parsed, numPages));
                } else {
                  setPageInput(String(currentPage));
                }
              }}
              aria-label="Current page"
              className="h-7 w-10 rounded-md border border-border bg-background px-1.5 text-center text-caption font-semibold tabular-nums text-foreground/90 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
            <span className="text-caption font-medium text-foreground/55">
              / {numPages ?? '—'}
            </span>
          </form>
          <button
            type="button"
            onClick={() => { onPageChange(clampPage(currentPage + 1, numPages)); }}
            title="Next page"
            aria-label="Next page"
            disabled={!canNext}
            className={buttonCls(!canNext)}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
