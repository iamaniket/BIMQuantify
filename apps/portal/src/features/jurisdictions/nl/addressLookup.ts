/**
 * PDOK Locatieserver client (Dutch government address lookup).
 *
 * Free, no API key, CORS-enabled. Service docs:
 *   https://github.com/PDOK/locatieserver/wiki/API-Locatieserver
 *
 * Two-step flow:
 *   1. /suggest?q=<query>&fq=type:adres → list of suggestion documents
 *      with id + weergavenaam (display string).
 *   2. /lookup?id=<id> → full address record + WGS84 centroid coordinates.
 */

import { z } from 'zod';

const BASE_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';

// ---------------------------------------------------------------------------
// /suggest
// ---------------------------------------------------------------------------

export type AddressSuggestion = {
  id: string;
  label: string;
  type: string;
};

const SuggestResponseSchema = z.object({
  response: z.object({
    docs: z.array(
      z.object({
        id: z.string(),
        weergavenaam: z.string(),
        type: z.string(),
      }),
    ),
  }),
});

export async function suggestAddresses(
  query: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  // No type filter — PDOK returns a mix of weg / postcode / adres / woonplaats
  // suggestions ordered by relevance. The user narrows down to a building-
  // level "adres" entry as they type more.
  const params = new URLSearchParams({
    q: trimmed,
    rows: '8',
  });
  const url = `${BASE_URL}/suggest?${params.toString()}`;

  const init: RequestInit = {
    method: 'GET',
    headers: { Accept: 'application/json' },
  };
  if (signal !== undefined) init.signal = signal;
  const resp = await fetch(url, init);
  if (!resp.ok) {
    throw new Error(`PDOK suggest failed: ${String(resp.status)}`);
  }
  const json: unknown = await resp.json();
  const parsed = SuggestResponseSchema.parse(json);
  return parsed.response.docs.map((d) => ({ id: d.id, label: d.weergavenaam, type: d.type }));
}

// ---------------------------------------------------------------------------
// /lookup
// ---------------------------------------------------------------------------

const LookupDocSchema = z.object({
  straatnaam: z.string().optional(),
  huisnummer: z.number().int().optional(),
  huisletter: z.string().optional(),
  huisnummertoevoeging: z.string().optional(),
  postcode: z.string().optional(),
  woonplaatsnaam: z.string().optional(),
  gemeentenaam: z.string().optional(),
  nummeraanduiding_id: z.string().optional(),
  // "POINT(lon lat)" in EPSG:4326 (WGS84).
  centroide_ll: z.string().optional(),
});

const LookupResponseSchema = z.object({
  response: z.object({
    docs: z.array(LookupDocSchema),
  }),
});

export type ResolvedAddress = {
  street: string | null;
  houseNumber: string | null;
  postalCode: string | null;
  city: string | null;
  municipality: string | null;
  bagId: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** Combine numeric house number + optional letter + optional addition into a
 * single human string, matching how Dutch addresses are written. */
function buildHouseNumber(
  num: number | undefined,
  letter: string | undefined,
  addition: string | undefined,
): string | null {
  if (num === undefined) return null;
  let out = String(num);
  if (letter !== undefined && letter.length > 0) out += letter;
  if (addition !== undefined && addition.length > 0) out += `-${addition}`;
  return out;
}

/** "1012LM" → "1012 LM" (display format). */
function formatPostcode(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^\d{4}[A-Z]{2}$/.test(compact)) return raw;
  return `${compact.slice(0, 4)} ${compact.slice(4)}`;
}

/** Parse a WKT "POINT(lon lat)" string. Returns null if malformed. */
function parsePoint(raw: string | undefined): { lat: number; lon: number } | null {
  if (raw === undefined) return null;
  const match = /POINT\(([\-\d.]+)\s+([\-\d.]+)\)/i.exec(raw);
  if (match === null) return null;
  const lon = Number.parseFloat(match[1] ?? '');
  const lat = Number.parseFloat(match[2] ?? '');
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return { lat, lon };
}

export async function lookupAddress(id: string, signal?: AbortSignal): Promise<ResolvedAddress | null> {
  const params = new URLSearchParams({ id });
  const url = `${BASE_URL}/lookup?${params.toString()}`;

  const init: RequestInit = {
    method: 'GET',
    headers: { Accept: 'application/json' },
  };
  if (signal !== undefined) init.signal = signal;
  const resp = await fetch(url, init);
  if (!resp.ok) {
    throw new Error(`PDOK lookup failed: ${String(resp.status)}`);
  }
  const json: unknown = await resp.json();
  const parsed = LookupResponseSchema.parse(json);
  const doc = parsed.response.docs[0];
  if (doc === undefined) return null;

  const point = parsePoint(doc.centroide_ll);
  return {
    street: doc.straatnaam ?? null,
    houseNumber: buildHouseNumber(doc.huisnummer, doc.huisletter, doc.huisnummertoevoeging),
    postalCode: formatPostcode(doc.postcode),
    city: doc.woonplaatsnaam ?? null,
    municipality: doc.gemeentenaam ?? null,
    bagId: doc.nummeraanduiding_id ?? null,
    latitude: point?.lat ?? null,
    longitude: point?.lon ?? null,
  };
}
