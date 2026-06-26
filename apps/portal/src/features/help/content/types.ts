import type { AppIcon } from '@bimdossier/ui/icons';

/** A string rendered in either locale. Both languages are required (strict bilingual). */
export type LocalizedText = { en: string; nl: string };

/**
 * Documentation category keys. Display labels resolve via the `help.categories.*`
 * i18n namespace in `messages/{en,nl}.json` — keep this union and those keys in sync.
 */
export type HelpCategory =
  | 'gettingStarted'
  | 'modelsUploads'
  | 'viewer'
  | 'findings'
  | 'compliance'
  | 'deadlines'
  | 'account';

/** Canonical ordering of categories in the nav rail and hub. */
export const HELP_CATEGORY_ORDER: HelpCategory[] = [
  'gettingStarted',
  'modelsUploads',
  'viewer',
  'findings',
  'compliance',
  'deadlines',
  'account',
];

export type HelpArticle = {
  /** URL segment under `/help/[slug]`; must be unique across the registry. */
  slug: string;
  category: HelpCategory;
  icon: AppIcon;
  /** Sort order within a category (ascending). */
  order: number;
  /** ISO date `YYYY-MM-DD` the article was last revised. Drives the "Last updated" KPI. */
  lastUpdated: string;
  title: LocalizedText;
  /** One-line summary shown in the rail and hub cards. */
  summary: LocalizedText;
  /** Full markdown body, required in both locales. A missing translation is a type error. */
  body: LocalizedText;
};
