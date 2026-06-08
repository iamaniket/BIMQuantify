/**
 * HTML shell for every PDF template. Inlines the report stylesheet so
 * Puppeteer can render the page without filesystem access. Page size +
 * margins + page numbering are configured via the @page CSS rule and the
 * `displayHeaderFooter` option on `page.pdf`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedCss: string | null = null;

function loadStyles(): string {
  if (cachedCss !== null) return cachedCss;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // styles.css sits at ../assets/styles.css relative to this file
  const cssPath = path.resolve(here, '..', 'assets', 'styles.css');
  cachedCss = readFileSync(cssPath, 'utf-8');
  return cachedCss;
}

export type LayoutInput = {
  title: string;
  generatedAt: string;
  body: string;
  /** ISO locale code (e.g. 'nl', 'en') — sets <html lang>. Defaults to 'nl'. */
  locale?: string;
};

export function layout({ title, generatedAt, body, locale }: LayoutInput): string {
  const lang = locale || 'nl';
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>${loadStyles()}</style>
</head>
<body>
  <main>${body}</main>
  <footer class="page-footer" data-generated-at="${generatedAt}">
    BimDossier · ${generatedAt}
  </footer>
</body>
</html>`;
}
