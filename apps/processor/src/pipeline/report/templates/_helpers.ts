/**
 * Shared rendering helpers + payload sub-types for the report templates that
 * landed after the compliance report (assurance_plan / completion_declaration /
 * dossier — backlog #31/#32/#33). The original compliance template keeps its
 * own local copies; these are the de-duplicated versions for the new templates.
 */

import { z } from 'zod';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escaped value with a fallback for null/blank. */
export function or(value: string | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined) return fallback;
  const trimmed = String(value).trim();
  return trimmed === '' ? fallback : escapeHtml(trimmed);
}

/** ISO timestamp → "DD-MM-YYYY HH:MM UTC" (worker has no locale db). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/** ISO date → "DD-MM-YYYY" (no time — for planned/actual moment dates). */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

export type ReportAddress = {
  country?: string | null;
  street?: string | null;
  house_number?: string | null;
  postal_code?: string | null;
  city?: string | null;
  municipality?: string | null;
  bag_id?: string | null;
};

export function addressLine(addr: ReportAddress | null | undefined): string {
  if (!addr) return '—';
  const street = [addr.street, addr.house_number].filter(Boolean).join(' ');
  const city = [addr.postal_code, addr.city].filter(Boolean).join(' ');
  const parts = [street, city, addr.municipality].filter((s) => s && String(s).trim() !== '');
  return parts.length === 0 ? '—' : escapeHtml(parts.join(', '));
}

export type ReportContractor = {
  name?: string | null;
  kvk_number?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
};

export type ReportProject = {
  id: string;
  name: string;
  country?: string | null;
  reference_code?: string | null;
  status?: string | null;
  phase?: string | null;
  address?: ReportAddress | null;
  permit_number?: string | null;
  delivery_date?: string | null;
  contractor?: ReportContractor | null;
};

export type ReportInstrument = {
  id: string;
  name: string;
  provider?: string | null;
  methodology_url?: string | null;
};

/** Runtime schema for the project snapshot every report payload carries
 * (the API's `_project_payload`). Reused by the new orchestrators' payload
 * validators. */
export const reportProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string().nullable().optional(),
  reference_code: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  phase: z.string().nullable().optional(),
  address: z
    .object({
      country: z.string().nullable().optional(),
      street: z.string().nullable().optional(),
      house_number: z.string().nullable().optional(),
      postal_code: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      municipality: z.string().nullable().optional(),
      bag_id: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  permit_number: z.string().nullable().optional(),
  delivery_date: z.string().nullable().optional(),
  contractor: z
    .object({
      name: z.string().nullable().optional(),
      kvk_number: z.string().nullable().optional(),
      contact_email: z.string().nullable().optional(),
      contact_phone: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const reportInstrumentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    provider: z.string().nullable().optional(),
    methodology_url: z.string().nullable().optional(),
  })
  .nullable()
  .optional();
