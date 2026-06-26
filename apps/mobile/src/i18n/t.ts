import { en, type MessageKey } from './en';
import { nl } from './nl';

export type Locale = 'nl' | 'en';

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, nl };

export type TVars = Record<string, string | number>;

/** Look up `key` in `locale`, falling back to the product default (nl) then the
 * bare key, and interpolate `{var}` placeholders. */
export function translate(locale: Locale, key: MessageKey, vars?: TVars): string {
  const template = CATALOGS[locale][key] ?? nl[key] ?? key;
  if (vars === undefined) return template;
  return Object.entries(vars).reduce(
    (acc, [name, value]) => acc.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
    template,
  );
}

export type { MessageKey };
