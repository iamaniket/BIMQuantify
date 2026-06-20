import { describe, expect, it } from 'vitest';

import { defaultLocale, getLocaleLabel, isLocale, pickLocalized } from './common.js';

describe('isLocale', () => {
  it('accepts supported locales', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('nl')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isLocale('de')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale('EN')).toBe(false);
  });
});

describe('pickLocalized', () => {
  it('returns the requested locale when present', () => {
    expect(pickLocalized({ en: 'Hi', nl: 'Hoi' }, 'en')).toBe('Hi');
  });

  it('falls back to the default locale when the requested one is missing', () => {
    // defaultLocale is 'nl'
    expect(pickLocalized({ nl: 'Hoi' }, 'en')).toBe('Hoi');
  });

  it('falls back to the first available value when neither requested nor default is present', () => {
    expect(pickLocalized({ en: 'Hi' }, 'nl')).toBe('Hi');
  });

  it('returns an empty string for an empty map', () => {
    expect(pickLocalized({}, 'en')).toBe('');
  });

  it('defaults to the platform default locale when no locale arg is given', () => {
    expect(defaultLocale).toBe('nl');
    expect(pickLocalized({ en: 'Hi', nl: 'Hoi' })).toBe('Hoi');
  });
});

describe('getLocaleLabel', () => {
  it('returns the human label for each locale', () => {
    expect(getLocaleLabel('en')).toBe('English');
    expect(getLocaleLabel('nl')).toBe('Nederlands');
  });
});
