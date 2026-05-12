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
  className,
  style,
}: AuthShellProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex min-h-screen w-full flex-col overflow-hidden bg-surface-page text-foreground lg:flex-row',
        className,
      )}
      style={style}
    >
      <div
        className="relative flex flex-col overflow-hidden px-9 py-9 text-white"
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

        <div className="flex flex-1 flex-col justify-center">
          <div className="mx-auto flex w-full max-w-[420px] flex-col">{form}</div>
        </div>

        {footer !== undefined ? <div className="mt-6">{footer}</div> : null}
      </div>
    </div>
  );
}
