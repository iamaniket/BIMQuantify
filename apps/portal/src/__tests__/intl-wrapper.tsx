import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';

import enMessages from '../../messages/en.json';
import nlMessages from '../../messages/nl.json';

type Props = {
  children: ReactNode;
  locale?: 'en' | 'nl';
};

const messagesByLocale = { en: enMessages, nl: nlMessages } as const;

export function IntlWrapper({ children, locale = 'en' }: Props): ReactNode {
  return (
    <NextIntlClientProvider locale={locale} messages={messagesByLocale[locale]}>
      {children}
    </NextIntlClientProvider>
  );
}
