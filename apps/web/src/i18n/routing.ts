import { defineRouting } from 'next-intl/routing';

import { defaultLocale, supportedLocales } from '@bimstitch/i18n';

export const routing = defineRouting({
  locales: [...supportedLocales],
  defaultLocale,
  localePrefix: 'always',
  localeCookie: {
    name: 'NEXT_LOCALE',
    maxAge: 60 * 60 * 24 * 365,
  },
});
