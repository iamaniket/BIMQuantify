import type { Locale } from '../common.js';
import { sharedEnMessages } from './en.js';
import { sharedNlMessages } from './nl.js';
import type { SharedMessages } from './types.js';

const sharedMessagesByLocale = {
  en: sharedEnMessages,
  nl: sharedNlMessages,
} as const satisfies Record<Locale, SharedMessages>;

export function getSharedMessages(locale: Locale): SharedMessages {
  return sharedMessagesByLocale[locale];
}

export type { SharedMessages } from './types.js';
