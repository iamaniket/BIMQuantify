import type { Locale } from '../common.js';
import { legalEnContent } from './en.js';
import { legalNlContent } from './nl.js';
import type { LegalContent } from './types.js';

const legalContentByLocale = {
  en: legalEnContent,
  nl: legalNlContent,
} as const satisfies Record<Locale, LegalContent>;

export function getLegalContent(locale: Locale): LegalContent {
  return legalContentByLocale[locale];
}

export type { LegalContent, LegalDocument, LegalMeta, LegalSection } from './types.js';
