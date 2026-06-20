'use client';

import { useLocale } from 'next-intl';

import { getFeatureContent, type FeatureContent } from './featureContent';

/**
 * Resolve a feature's content for the active locale. Centralizes the
 * `useLocale()` + `getFeatureContent()` lookup that every `Feature*` detail
 * component repeated. Returns `content: null` for unknown/coming-soon slugs so
 * the caller can early-`return null`. `locale` is returned too for the rare
 * caller (FeatureRelated) that resolves sibling slugs in a loop.
 */
export function useFeatureContent(featureKey: string): {
  content: FeatureContent | null;
  locale: string;
} {
  const locale = useLocale();
  return { content: getFeatureContent(featureKey, locale), locale };
}
