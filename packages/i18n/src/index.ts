export {
  defaultLocale,
  getLocaleLabel,
  isLocale,
  localeStorageKey,
  normalizeLocale,
  pickLocalized,
  supportedLocales,
} from './common.js';

export type { Locale } from './common.js';

export { getLegalContent } from './legal/index.js';
export type { LegalContent, LegalDocument, LegalMeta, LegalSection } from './legal/index.js';

export { getWebMessages } from './web/index.js';
export type { WebMessages } from './web/index.js';
