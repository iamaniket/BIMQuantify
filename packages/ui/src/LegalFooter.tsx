import type { JSX } from 'react';

import { cn } from './lib/cn.js';

export interface LegalFooterLink {
  href: string;
  label: string;
}

export interface LegalFooterProps {
  /** Year shown in the copyright. Defaults to the current calendar year. */
  year?: number;
  /** Company name shown after the copyright glyph. */
  company?: string;
  /** Tail text after the company (e.g. compliance flag). */
  tail?: string;
  /** Light-text variant for coloured backgrounds. */
  tone?: 'on-dark' | 'on-light';
  /** Right-side links (Privacy / Terms / Status / Help). */
  links?: readonly LegalFooterLink[];
  className?: string;
}

const DEFAULT_LINKS: readonly LegalFooterLink[] = [
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/terms', label: 'Terms' },
  { href: '/status', label: 'Status' },
];

export function LegalFooter({
  year = new Date().getFullYear(),
  company = 'BimStitch B.V.',
  tail = 'Wkb 2026.1',
  tone = 'on-light',
  links = DEFAULT_LINKS,
  className,
}: LegalFooterProps): JSX.Element {
  const fg = tone === 'on-dark' ? 'rgba(255,255,255,0.55)' : 'var(--color-foreground-tertiary, #4b5563)';
  const fgLink = tone === 'on-dark' ? 'rgba(255,255,255,0.85)' : 'var(--color-foreground-secondary, #1f2937)';
  return (
    <div
      className={cn('flex items-center justify-between font-mono text-[11px] tracking-[0.02em]', className)}
      style={{ color: fg }}
    >
      <div>© {year} {company}{tail ? ` · ${tail}` : ''}</div>
      <div className="flex gap-3.5">
        {links.map((link) => (
          <a key={link.href} href={link.href} style={{ color: fgLink, textDecoration: 'none' }}>
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}
