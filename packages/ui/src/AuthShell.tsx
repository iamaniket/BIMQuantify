import type { CSSProperties, JSX, ReactNode } from 'react';

import { cn } from './lib/cn.js';

export interface AuthShellProps {
  /** Content rendered in the left brand canvas (BrandMark + hero copy + KPI strip + optional map). */
  brand: ReactNode;
  /** Slot rendered above the form pane (status badge, region, etc.). Optional. */
  topRight?: ReactNode;
  /** The form column — heading + form + secondary CTA. */
  form: ReactNode;
  /** Slot rendered at the bottom of the form column (LegalFooter typically). */
  footer?: ReactNode;
  /** Flex basis (CSS value) for the brand pane. Defaults to "54%" (login). */
  brandPaneWidth?: string;
  /** Background of the form pane. Defaults to the page surface token. */
  formBackground?: string;
  /**
   * Max-width (CSS value) of the inner form column. Defaults to "420px"
   * which suits a sign-in / request-access form. Long-form content
   * (legal, settings) should bump this to ~560–640px.
   */
  formContentMaxWidth?: string;
  /**
   * Vertical alignment of the inner form column. "center" suits short
   * forms (default); "start" suits long content that should scroll
   * naturally from the top.
   */
  formContentAlign?: 'center' | 'start';
  /**
   * When true the brand pane sticks to the top of the viewport on
   * desktop so it remains visible while the form column scrolls. Useful
   * for long-form content alongside the same brand canvas.
   */
  brandSticky?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Two-column auth shell — brand canvas left, form pane right.
 *
 * Used by both the login page (default 54/46 split) and the request-access
 * page (44/56). The brand canvas owns its own background; the form pane
 * defaults to the page surface so embedded forms feel weightless.
 *
 * Below ~960px the two panes stack so the page stays usable on smaller
 * laptops and tablets — the brand pane keeps a fixed-height hero on
 * mobile so the page doesn't feel chrome-heavy.
 */
export function AuthShell({
  brand,
  topRight,
  form,
  footer,
  brandPaneWidth = '54%',
  formBackground = 'var(--surface-page, #ffffff)',
  formContentMaxWidth = '420px',
  formContentAlign = 'center',
  brandSticky = false,
  className,
  style,
}: AuthShellProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex min-h-screen w-full flex-col bg-surface-page text-foreground lg:flex-row',
        // overflow-hidden is fine for short shells (login) but clips
        // sticky positioning, so we only apply it when the brand isn't
        // sticky. With sticky brand, the parent must allow overflow.
        brandSticky ? '' : 'overflow-hidden',
        className,
      )}
      style={style}
    >
      <div
        className={cn(
          'relative flex flex-col overflow-hidden px-9 py-9 text-white',
          brandSticky ? 'lg:sticky lg:top-0 lg:h-screen' : '',
        )}
        style={{
          flex: `0 0 ${brandPaneWidth}`,
          background: 'linear-gradient(180deg, #2c5697 0%, #1e3e72 100%)',
          minHeight: '32vh',
        }}
      >
        {brand}
      </div>

      <div
        className="relative flex flex-1 flex-col px-8 py-9 lg:px-14"
        style={{ background: formBackground }}
      >
        {topRight !== undefined ? (
          <div className="flex items-center justify-between">{topRight}</div>
        ) : null}

        <div
          className={cn(
            'flex flex-1 flex-col',
            formContentAlign === 'center' ? 'justify-center' : 'justify-start',
          )}
        >
          <div
            className="mx-auto flex w-full flex-col"
            style={{ maxWidth: formContentMaxWidth }}
          >
            {form}
          </div>
        </div>

        {footer !== undefined ? <div className="mt-6">{footer}</div> : null}
      </div>
    </div>
  );
}
