'use client';

import { useTranslations } from 'next-intl';
import { type JSX } from 'react';

export type ViewerMobileBannerProps = {
  onDismiss: () => void;
}

export function ViewerMobileBanner({ onDismiss }: ViewerMobileBannerProps): JSX.Element {
  const t = useTranslations('viewer.mobileBanner');
  return (
    <div className="flex items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-body3 text-foreground md:hidden">
      <span>{t('message')}</span>
      <button
        type="button"
        aria-label={t('dismiss')}
        onClick={onDismiss}
        className="shrink-0 rounded px-2 py-0.5 text-caption font-semibold hover:bg-warning/20"
      >
        {t('ok')}
      </button>
    </div>
  );
}
