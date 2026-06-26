'use client';

import type { Locale } from '@bimdossier/i18n';
import { useLocale } from 'next-intl';
import { useMemo } from 'react';

import {
  HELP_ARTICLES,
  HELP_CATEGORY_ORDER,
  type HelpArticle,
  type HelpCategory,
} from './content';

/** An article with its localized strings already resolved for the active locale. */
export type LocalizedArticle = {
  slug: string;
  category: HelpCategory;
  icon: HelpArticle['icon'];
  order: number;
  lastUpdated: string;
  title: string;
  summary: string;
  body: string;
};

function localize(article: HelpArticle, locale: Locale): LocalizedArticle {
  return {
    slug: article.slug,
    category: article.category,
    icon: article.icon,
    order: article.order,
    lastUpdated: article.lastUpdated,
    title: article.title[locale],
    summary: article.summary[locale],
    body: article.body[locale],
  };
}

/** All articles, localized and sorted by `order`. */
export function useHelpArticles(): LocalizedArticle[] {
  const locale = useLocale() as Locale;
  return useMemo(
    () => HELP_ARTICLES.map((a) => localize(a, locale)).sort((x, y) => x.order - y.order),
    [locale],
  );
}

/** A single article by slug, or `undefined` if it is not in the registry. */
export function useHelpArticle(slug: string): LocalizedArticle | undefined {
  const locale = useLocale() as Locale;
  return useMemo(() => {
    const found = HELP_ARTICLES.find((a) => a.slug === slug);
    return found === undefined ? undefined : localize(found, locale);
  }, [slug, locale]);
}

export type HelpCategoryGroup = {
  category: HelpCategory;
  articles: LocalizedArticle[];
};

/** Articles grouped by category in canonical order; empty categories are omitted. */
export function useHelpCategories(): HelpCategoryGroup[] {
  const articles = useHelpArticles();
  return useMemo(
    () =>
      HELP_CATEGORY_ORDER.map((category) => ({
        category,
        articles: articles
          .filter((a) => a.category === category)
          .sort((x, y) => x.order - y.order),
      })).filter((group) => group.articles.length > 0),
    [articles],
  );
}

export type HelpStats = {
  articleCount: number;
  categoryCount: number;
  /** Most recent `lastUpdated` across all articles (ISO date), or `null` if empty. */
  lastUpdated: string | null;
};

/** Derived KPI figures for the hero strip. */
export function useHelpStats(): HelpStats {
  const articles = useHelpArticles();
  const categories = useHelpCategories();
  return useMemo(() => {
    const lastUpdated = articles.reduce<string | null>(
      (acc, a) => (acc === null || a.lastUpdated > acc ? a.lastUpdated : acc),
      null,
    );
    return {
      articleCount: articles.length,
      categoryCount: categories.length,
      lastUpdated,
    };
  }, [articles, categories]);
}
