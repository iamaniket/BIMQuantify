import type { Locale } from '../common.js';
import { portalEnMessages } from './en.js';
import { portalNlMessages } from './nl.js';
import type { PortalMessages } from './types.js';

const portalMessagesByLocale = {
  en: portalEnMessages,
  nl: portalNlMessages,
} as const satisfies Record<Locale, PortalMessages>;

export function getPortalMessages(locale: Locale): PortalMessages {
  return portalMessagesByLocale[locale];
}

export type { PortalMessages } from './types.js';