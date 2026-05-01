import type { Locale } from '../common.js';
import { webEnMessages } from './en.js';
import { webNlMessages } from './nl.js';
import type { WebMessages } from './types.js';

const webMessagesByLocale = {
  en: webEnMessages,
  nl: webNlMessages,
} as const satisfies Record<Locale, WebMessages>;

export function getWebMessages(locale: Locale): WebMessages {
  return webMessagesByLocale[locale];
}

export type { WebMessages } from './types.js';