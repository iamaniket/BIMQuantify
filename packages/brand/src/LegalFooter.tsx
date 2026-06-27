import type { JSX } from 'react';

import { cn } from '@bimdossier/ui';

export interface LegalFooterLink {
  href: string;
  label: string;
}

export interface LegalFooterProps {
  year?: number;
  company?: string;
  tail?: string;
  tone?: 'on-dark' | 'on-light';
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
  // Plain product name until the holding/parent entity is registered; callers
  // can pass the registered entity (e.g. "BimDossier B.V.") once it exists.
  company = 'BimDossier',
  tail = 'Wet kwaliteitsborging voor het bouwen (Wkb)',
  tone = 'on-light',
  links = DEFAULT_LINKS,
  className,
}: LegalFooterProps): JSX.Element {
  const fg = tone === 'on-dark' ? 'rgba(255,255,255,0.55)' : 'var(--foreground-tertiary, #4b5563)';
  const fgLink = tone === 'on-dark' ? 'rgba(255,255,255,0.85)' : 'var(--foreground-secondary, #1f2937)';
  return (
    <div
      className={cn('flex items-center justify-between font-sans text-[11px] tracking-[0.02em]', className)}
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
