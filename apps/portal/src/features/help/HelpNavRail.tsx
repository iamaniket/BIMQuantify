'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { SearchInput } from '@/components/shared/PageTable';
import { Link, usePathname } from '@/i18n/navigation';

import type { HelpCategory } from './content';
import { useHelpCategories } from './useHelpContent';

export function HelpNavRail(): ReactNode {
  const t = useTranslations('help');
  const tCat = useTranslations('help.categories');
  const pathname = usePathname();
  const categories = useHelpCategories();
  const [query, setQuery] = useState('');

  // Resolve every category label up front — keeps lookups type-safe (no dynamic key).
  const categoryLabels: Record<HelpCategory, string> = {
    gettingStarted: tCat('gettingStarted'),
    modelsUploads: tCat('modelsUploads'),
    viewer: tCat('viewer'),
    findings: tCat('findings'),
    compliance: tCat('compliance'),
    deadlines: tCat('deadlines'),
    account: tCat('account'),
  };

  const q = query.trim().toLowerCase();
  const filtered =
    q === ''
      ? categories
      : categories
          .map((group) => ({
            category: group.category,
            articles: group.articles.filter(
              (a) =>
                a.title.toLowerCase().includes(q) ||
                a.summary.toLowerCase().includes(q) ||
                a.body.toLowerCase().includes(q),
            ),
          }))
          .filter((group) => group.articles.length > 0);

  return (
    <nav className="flex max-h-[38vh] min-h-0 shrink-0 flex-col gap-3 overflow-y-auto border-b border-border bg-surface-main p-3 md:h-full md:max-h-none md:shrink md:border-b-0 md:border-r">
      <SearchInput
        placeholder={t('rail.searchPlaceholder')}
        value={query}
        onChange={setQuery}
        aria-label={t('rail.searchPlaceholder')}
      />
      <div className="flex flex-col gap-4">
        {filtered.map((group) => (
          <div key={group.category} className="flex flex-col gap-1">
            <div className="px-2 text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
              {categoryLabels[group.category]}
            </div>
            {group.articles.map((article) => {
              const href = `/help/${article.slug}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              const Icon = article.icon;
              return (
                <Link
                  key={article.slug}
                  href={href}
                  className={
                    active
                      ? 'flex items-center gap-2 rounded-md border border-primary-light bg-primary-lighter px-2 py-1.5 text-body3 font-medium text-primary'
                      : 'flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-body3 text-foreground-secondary transition-colors hover:border-border hover:bg-background-hover'
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{article.title}</span>
                </Link>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="px-2 text-body3 text-foreground-tertiary">{t('rail.noResults')}</p>
        )}
      </div>
    </nav>
  );
}
