import { getSharedMessages } from '@bimstitch/i18n';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const baseMessages = (await import(`../../messages/${locale}.json`)).default;
  const messages = { ...baseMessages, shared: getSharedMessages(locale) };
  return { locale, messages };
});
