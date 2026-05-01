export {
  defaultLocale,
  formatMessage,
  getLocaleLabel,
  isLocale,
  localeStorageKey,
  normalizeLocale,
  supportedLocales,
} from './common.js';

export type { Locale } from './common.js';

export { getPortalMessages } from './portal/index.js';
export type { PortalMessages } from './portal/index.js';

export { getWebMessages } from './web/index.js';
export type { WebMessages } from './web/index.js';