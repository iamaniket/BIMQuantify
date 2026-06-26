'use client';

import type { Locale } from '@bimdossier/i18n';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { formatDate } from '@/lib/formatting/dates';

import { MarkdownProse } from './MarkdownProse';
import type { LocalizedArticle } from './useHelpContent';

export function HelpArticleView({ article }: { article: LocalizedArticle }): ReactNode {
  const t = useTranslations('help.article');
  const locale = useLocale() as Locale;
  const Icon = article.icon;

  return (
    <article className="mx-auto w-full max-w-3xl">
      <header className="mb-6 border-b border-border pb-5">
        <div className="mb-2 flex items-center gap-1.5 text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
          <Icon className="h-4 w-4" />
          <span>
            {t('lastUpdatedLabel')}: {formatDate(article.lastUpdated, locale)}
          </span>
        </div>
        <h1 className="text-title1 font-semibold tracking-[-0.015em] text-foreground">
          {article.title}
        </h1>
        <p className="mt-1.5 text-body1 text-foreground-secondary">{article.summary}</p>
      </header>
      <MarkdownProse>{article.body}</MarkdownProse>
    </article>
  );
}
