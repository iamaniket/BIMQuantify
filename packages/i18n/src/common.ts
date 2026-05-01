export const supportedLocales = ['en', 'nl'] as const;

export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = 'en';

export const localeStorageKey = 'bimstitch.locale';

export function isLocale(value: string): value is Locale {
  return supportedLocales.includes(value as Locale);
}

export function normalizeLocale(value: string | null | undefined): Locale {
  return value !== null && value !== undefined && isLocale(value) ? value : defaultLocale;
}

export function formatMessage(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

const localeLabels = {
  en: 'English',
  nl: 'Nederlands',
} as const satisfies Record<Locale, string>;

export function getLocaleLabel(locale: Locale): string {
  return localeLabels[locale];
}