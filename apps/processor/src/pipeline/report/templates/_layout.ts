/**
 * HTML shell for every PDF template. Inlines the report stylesheet so
 * Puppeteer can render the page without filesystem access. Page size +
 * margins + page numbering are configured via the @page CSS rule and the
 * `displayHeaderFooter` option on `page.pdf`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeHtml } from './_helpers.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// The logo is resolved from MinIO and base64-embedded by `embedTemplateLogo`
// before render — it is always an inline `data:image/<type>;base64,<data>` URL,
// never a remote URL. Restricting it to that shape closes a Puppeteer SSRF /
// `networkidle0` fetch surface (an `http(s)`/`file:` src would be fetched at
// render time) and the strict charset means the value can't break out of the
// `src="..."` attribute. Anything else resolves to no logo.
const DATA_IMAGE_URL = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i;

function brandLogoTag(logoDataUrl: string | null | undefined): string {
  if (!logoDataUrl || !DATA_IMAGE_URL.test(logoDataUrl)) return '';
  // escapeHtml is a no-op on a valid base64 data URL (none of & < > " ' occur in
  // it) but keeps the attribute injection-proof as defence in depth.
  return `<img class="brand-logo" src="${escapeHtml(logoDataUrl)}" alt="" />`;
}

let cachedCss: string | null = null;

function loadStyles(): string {
  if (cachedCss !== null) return cachedCss;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // styles.css sits at ../assets/styles.css relative to this file
  const cssPath = path.resolve(here, '..', 'assets', 'styles.css');
  cachedCss = readFileSync(cssPath, 'utf-8');
  return cachedCss;
}

/** Optional template branding applied around the report body. Asset data URLs
 * are resolved by the orchestrator's `embedTemplateLogo` before render. */
export type LayoutBranding = {
  logoDataUrl?: string | null;
  accentColor?: string | null;
  accentColorSecondary?: string | null;
  headerText?: string | null;
  footerText?: string | null;
};

export type LayoutInput = {
  title: string;
  generatedAt: string;
  body: string;
  /** ISO locale code (e.g. 'nl', 'en') — sets <html lang>. Defaults to 'nl'. */
  locale?: string;
  branding?: LayoutBranding | null;
};

export function layout({ title, generatedAt, body, locale, branding }: LayoutInput): string {
  const lang = locale || 'nl';

  // Accent overrides: inject AFTER the main stylesheet so they win. Hex is
  // re-validated here (defence in depth) before landing in a <style> block.
  const vars: string[] = [];
  if (branding?.accentColor && HEX_COLOR.test(branding.accentColor)) {
    vars.push(`--c-primary:${branding.accentColor};`);
  }
  if (branding?.accentColorSecondary && HEX_COLOR.test(branding.accentColorSecondary)) {
    vars.push(`--c-secondary:${branding.accentColorSecondary};`);
  }
  const accentStyle = vars.length > 0 ? `<style>:root{${vars.join('')}}</style>` : '';

  const logo = brandLogoTag(branding?.logoDataUrl);
  const headerText = branding?.headerText
    ? `<div class="brand-header">${escapeHtml(branding.headerText)}</div>`
    : '';
  const brandBand = logo || headerText ? `<div class="brand-band">${logo}${headerText}</div>` : '';

  const footerLabel = branding?.footerText ? escapeHtml(branding.footerText) : 'BimDossier';

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>${loadStyles()}</style>
  ${accentStyle}
</head>
<body>
  ${brandBand}
  <main>${body}</main>
  <footer class="page-footer" data-generated-at="${generatedAt}">
    ${footerLabel} · ${generatedAt}
  </footer>
</body>
</html>`;
}
