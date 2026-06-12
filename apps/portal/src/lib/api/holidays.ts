import { z } from 'zod';

import { apiClient } from './client';

const HolidaySchema = z.object({
  /** ISO `YYYY-MM-DD` — matches the calendar's day keys. */
  date: z.string(),
  name: z.string(),
});

export type Holiday = z.infer<typeof HolidaySchema>;

const HolidayListResponseSchema = z.object({
  items: z.array(HolidaySchema),
});

/**
 * National public holidays for a country/year, sourced from the same
 * `holidays` library the deadline engine uses (so they never drift). Public
 * endpoint — no auth. A country the library doesn't implement returns `[]`.
 */
export async function listHolidays(
  country: string,
  year: number,
  locale?: string,
): Promise<Holiday[]> {
  const params = new URLSearchParams({ year: String(year) });
  if (locale !== undefined) params.set('locale', locale);
  const body = await apiClient.get(
    `/jurisdictions/${encodeURIComponent(country.toUpperCase())}/holidays?${params.toString()}`,
    HolidayListResponseSchema,
    undefined,
  );
  return body.items;
}
