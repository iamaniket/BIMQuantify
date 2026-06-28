'use client';

import { Button } from '@bimdossier/ui';
import { useTranslations } from 'next-intl';
import { useEffect, type JSX } from 'react';

import { AuthFormIntro } from '@/features/auth/AuthFormIntro';
import { Link } from '@/i18n/navigation';

/**
 * "Coming soon" body for the free-viewer landing (Phase 0 of the free-wedge
 * plan). The full tier (upload + snag) is built in later phases; for now we
 * explain the value, route interested users into the proven request-access
 * capture, and fire a no-op-safe analytics event so demand is measurable the
 * moment an analytics provider is wired (a marketing-plan wk1 task).
 */
export function FreeViewerComingSoon(): JSX.Element {
  const t = useTranslations('freeViewer');

  useEffect(() => {
    const w = window as unknown as { plausible?: (event: string) => void };
    w.plausible?.('free_viewer_landing_view');
  }, []);

  const bullets = [t('bullet1'), t('bullet2'), t('bullet3')];

  return (
    <>
      <AuthFormIntro eyebrow={t('eyebrow')} heading={t('heading')} subtitle={t('subtitle')} />

      <ul className="mb-6 flex flex-col gap-2.5">
        {bullets.map((bullet) => (
          <li
            key={bullet}
            className="flex items-start gap-2 text-body3 text-foreground-secondary"
          >
            <span
              aria-hidden
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
            />
            {bullet}
          </li>
        ))}
      </ul>

      <Link href="/request-access">
        <Button variant="primary" size="lg" className="w-full">
          {t('cta')}
        </Button>
      </Link>

      <p className="mt-3 text-body3 text-foreground-tertiary">{t('note')}</p>
    </>
  );
}
