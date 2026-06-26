'use client';

import { ArrowRight, HelpCircle } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { EmptyState } from '@bimdossier/ui';

import { Link } from '@/i18n/navigation';

import type { HelpCategory } from './content';
import { useHelpCategories } from './useHelpContent';

export function HelpHubView(): ReactNode {
  const t = useTranslations('help');
  const tCat = useTranslations('help.categories');
  const categories = useHelpCategories();

  const categoryLabels: Record<HelpCategory, string> = {
    gettingStarted: tCat('gettingStarted'),
    modelsUploads: tCat('modelsUploads'),
    viewer: tCat('viewer'),
    findings: tCat('findings'),
    compliance: tCat('compliance'),
    deadlines: tCat('deadlines'),
    account: tCat('account'),
  };

  if (categories.length === 0) {
    return (
      <EmptyState
        icon={HelpCircle}
        title={t('hub.emptyTitle')}
        description={t('hub.emptyDescription')}
        action={undefined}
        className={undefined}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-6">
        <h1 className="text-title1 font-semibold tracking-[-0.015em] text-foreground">
          {t('hub.welcomeTitle')}
        </h1>
        <p className="mt-1.5 text-body1 text-foreground-secondary">{t('hub.welcomeBody')}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {categories.map((group) => {
          const first = group.articles[0];
          if (first === undefined) return null;
          const Icon = first.icon;
          return (
            <Link
              key={group.category}
              href={`/help/${first.slug}`}
              className="group flex items-start gap-3 rounded-xl border border-border bg-surface-main p-4 transition-colors hover:border-primary-light hover:bg-primary-lighter"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-lighter text-primary transition-colors group-hover:bg-surface-main">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-body1 font-semibold text-foreground">
                  {categoryLabels[group.category]}
                  <ArrowRight className="h-3.5 w-3.5 text-foreground-tertiary transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="mt-0.5 block text-body3 text-foreground-tertiary">
                  {t('hub.articleCount', { count: group.articles.length })}
                </span>
                <span className="mt-1 block line-clamp-2 text-body3 text-foreground-secondary">
                  {first.summary}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
