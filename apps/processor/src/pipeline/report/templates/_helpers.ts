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

// A base64 image data URL with an allow-listed raster MIME. Mirrors the logo
// guard in _layout.ts. SEAM-XSS-SSRF-1: the photo `content_type` is caller-
// controlled at upload, so it must never be interpolated raw into a data: URL /
// <img src>. `image/svg+xml` is deliberately EXCLUDED — SVG can carry script.
export const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i;

const _IMAGE_MIME_ALLOWLIST = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
]);

/**
 * Build a safe base64 image data URL from a caller-supplied `content_type` and
 * bytes, or return `null` when the type is not an allow-listed raster image.
 * The MIME is taken from a server-side allowlist (not trusted from the stored
 * value), and the base64 body's charset can't break out of an attribute — so the
 * result always matches IMAGE_DATA_URL. Callers render no <img> for a null.
 */
export function safeImageDataUrl(
  contentType: string | null | undefined,
  bytes: Uint8Array | Buffer,
): string | null {
  const mime = (contentType ?? '').trim().toLowerCase();
  const canonical = mime === 'image/jpg' ? 'image/jpeg' : mime;
  if (!_IMAGE_MIME_ALLOWLIST.has(canonical)) return null;
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:${canonical};base64,${b64}`;
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
};

/** Runtime schema for the project snapshot every report payload carries
 * (the API's `_project_payload`). Reused by the new orchestrators' payload
 * validators. */
export const reportProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string().nullable().optional(),
  reference_code: z.string().nullable().optional(),
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
});

// ---------------------------------------------------------------------------
// Report templates (branding wrapper + structured content)
// ---------------------------------------------------------------------------

/** Runtime schema for the optional `template` an org report-template injects into
 * the payload. Every field is optional/nullable so existing (template-less)
 * payloads validate unchanged. */
export const reportTemplateSchema = z
  .object({
    id: z.string().optional(),
    branding: z
      .object({
        logo_storage_key: z.string().nullable().optional(),
        logo_data_url: z.string().nullable().optional(),
        accent_color: z.string().nullable().optional(),
        accent_color_secondary: z.string().nullable().optional(),
        header_text: z.string().nullable().optional(),
        footer_text: z.string().nullable().optional(),
        cover_pdf_storage_key: z.string().nullable().optional(),
        bucket: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    sections: z
      .array(
        z.union([
          z.object({
            type: z.literal('content'),
            key: z.string(),
            enabled: z.boolean().optional(),
            title_override: z.string().nullable().optional(),
          }),
          z.object({
            type: z.literal('text'),
            id: z.string(),
            title: z.string().nullable().optional(),
            body: z.string(),
            enabled: z.boolean().optional(),
          }),
        ]),
      )
      .optional(),
    options: z
      .object({
        signature_label: z.string().nullable().optional(),
        show_toc: z.boolean().optional(),
      })
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();

export type ReportTemplateBranding = {
  logo_storage_key?: string | null;
  logo_data_url?: string | null;
  accent_color?: string | null;
  accent_color_secondary?: string | null;
  header_text?: string | null;
  footer_text?: string | null;
  cover_pdf_storage_key?: string | null;
  bucket?: string | null;
};

export type ReportTemplateSection =
  | { type: 'content'; key: string; enabled?: boolean; title_override?: string | null }
  | { type: 'text'; id: string; title?: string | null; body: string; enabled?: boolean };

export type ReportTemplate = {
  id?: string;
  branding?: ReportTemplateBranding | null;
  sections?: ReportTemplateSection[];
  options?: { signature_label?: string | null; show_toc?: boolean } | null;
};

/** Logic-less `{{a.b.c}}` interpolation over a context object. Walks dotted
 * paths; unknown/blank paths resolve to '' and every value is HTML-escaped.
 * No code execution — safe for user-authored text blocks. */
export function interpolate(tpl: string, ctx: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    let cur: unknown = ctx;
    for (const part of path.split('.')) {
      if (cur !== null && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        return '';
      }
    }
    if (cur === null || cur === undefined) return '';
    return escapeHtml(String(cur));
  });
}

/** Build the scalar merge context for a report payload's text blocks. */
export function buildMergeContext(payload: {
  project: ReportProject;
  generated_at: string;
}): Record<string, unknown> {
  return {
    project: payload.project,
    report: { generated_at: fmtDate(payload.generated_at) },
  };
}

/** One built-in content section: its key, default heading, and inner HTML. */
export type ContentSectionRender = { key: string; defaultTitle: string; html: string };

function pageSection(title: string, inner: string): string {
  return `<section class="page"><h2>${escapeHtml(title)}</h2>${inner}</section>`;
}

/**
 * Render the ordered section list for a report body.
 *
 * - No template config → every content section in canonical order (the exact
 *   pre-template output).
 * - With config → only `enabled !== false` entries, in the configured order:
 *   `content` → its mapped inner HTML under `title_override ?? defaultTitle`;
 *   `text` → an interpolated free block (legal disclaimers etc.).
 */
export function renderSections(
  content: ContentSectionRender[],
  cfg: ReportTemplateSection[] | undefined | null,
  ctx: Record<string, unknown>,
): string {
  if (!cfg || cfg.length === 0) {
    return content.map((c) => pageSection(c.defaultTitle, c.html)).join('\n');
  }
  const byKey = new Map(content.map((c) => [c.key, c]));
  const out: string[] = [];
  for (const entry of cfg) {
    if (entry.enabled === false) continue;
    if (entry.type === 'content') {
      const c = byKey.get(entry.key);
      if (c) out.push(pageSection(entry.title_override || c.defaultTitle, c.html));
    } else {
      const heading = entry.title ? `<h2>${escapeHtml(entry.title)}</h2>` : '';
      out.push(
        `<section class="page">${heading}<div class="text-block">${interpolate(entry.body, ctx)}</div></section>`,
      );
    }
  }
  return out.join('\n');
}

/** Map a template's (snake_case) branding config to the `layout()` branding
 * shape. Returns undefined when there's no template so `layout` renders bare. */
export function toLayoutBranding(
  branding: ReportTemplateBranding | null | undefined,
):
  | {
      logoDataUrl?: string | null;
      accentColor?: string | null;
      accentColorSecondary?: string | null;
      headerText?: string | null;
      footerText?: string | null;
    }
  | undefined {
  if (!branding) return undefined;
  return {
    logoDataUrl: branding.logo_data_url,
    accentColor: branding.accent_color,
    accentColorSecondary: branding.accent_color_secondary,
    headerText: branding.header_text,
    footerText: branding.footer_text,
  };
}
