/**
 * Jurisdiction-keyed UI dispatchers.
 *
 * Shared portal components (AddressLookup, AddressMapPreview, ProjectCard…)
 * call these factories with the project's `country` instead of importing
 * from `jurisdictions/nl/...` directly. Adding DE is a sibling folder
 * (`jurisdictions/de/...`) plus an entry in the records below — no edits
 * to the consuming components.
 *
 * When `supported === false` the component should render a graceful
 * fallback (manual address input, no aerial thumbnail) rather than crash.
 */

import type { AerialThumbnailOptions } from './nl/mapThumbnail';
import {
  isWithinNetherlands as nlIsWithin,
  pdokAerialThumbnailUrl as nlAerialUrl,
} from './nl/mapThumbnail';
import {
  lookupAddress as nlLookupAddress,
  suggestAddresses as nlSuggestAddresses,
  type AddressSuggestion,
  type ResolvedAddress,
} from './nl/addressLookup';

export type { AddressSuggestion, ResolvedAddress, AerialThumbnailOptions };

export type AddressLookupAdapter = {
  /** Free-text suggestion list (debounced as the user types). */
  suggest: (query: string, signal?: AbortSignal) => Promise<AddressSuggestion[]>;
  /** Resolve a suggestion id to a full structured address. */
  lookup: (id: string, signal?: AbortSignal) => Promise<ResolvedAddress | null>;
  /** i18n key for the "Find address" label; resolved by the caller. */
  labelKey: string;
  /** User-visible attribution / data-source line. */
  attribution: string;
  /** Placeholder shown inside the input. */
  placeholder: string;
};

export type MapThumbnailAdapter = {
  /** Bounding-box check the caller uses to decide whether to render. */
  isWithinCountry: (latitude: number, longitude: number) => boolean;
  /** Build a static aerial-image URL for the given coords. */
  aerialUrl: (latitude: number, longitude: number, opts?: AerialThumbnailOptions) => string;
};

const ADDRESS_LOOKUP_BY_COUNTRY: Record<string, AddressLookupAdapter> = {
  NL: {
    suggest: nlSuggestAddresses,
    lookup: nlLookupAddress,
    labelKey: 'addressLookup.labelNL',
    attribution: 'Powered by PDOK Locatieserver — Dutch addresses only.',
    placeholder: 'Start typing street + city, e.g. Damrak 70 Amsterdam',
  },
};

const MAP_THUMBNAIL_BY_COUNTRY: Record<string, MapThumbnailAdapter> = {
  NL: {
    isWithinCountry: nlIsWithin,
    aerialUrl: nlAerialUrl,
  },
};

export function getAddressLookup(country: string | null | undefined): AddressLookupAdapter | null {
  if (country === null || country === undefined) return null;
  return ADDRESS_LOOKUP_BY_COUNTRY[country.toUpperCase()] ?? null;
}

export function getMapThumbnail(country: string | null | undefined): MapThumbnailAdapter | null {
  if (country === null || country === undefined) return null;
  return MAP_THUMBNAIL_BY_COUNTRY[country.toUpperCase()] ?? null;
}
