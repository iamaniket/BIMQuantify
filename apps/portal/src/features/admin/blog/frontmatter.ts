/**
 * Minimal YAML-frontmatter parser for the blog create dialog.
 *
 * Pure-string parse; no `js-yaml`/`gray-matter` dependency dragged into the
 * portal bundle. Supports exactly the subset our existing posts use:
 *
 *   ---
 *   title: "WKB Explained"
 *   description: "A short intro"
 *   date: "2026-05-20"
 *   tags: ["wkb", "compliance"]
 *   author: "BimDossier"
 *   ---
 *
 * Anything richer (multiline strings, anchors, nested maps) is intentionally
 * unsupported — the dialog hands the result to a form the user can correct
 * before submitting, so partial parses are recoverable.
 */

export type ParsedFrontmatter = {
  title?: string;
  description?: string;
  date?: string;
  tags?: string[];
  author?: string;
  // Everything after the closing `---`.
  body: string;
};

function stripQuotes(value: string): string {
  const t = value.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseInlineArray(raw: string): string[] {
  // Strip the surrounding brackets, split on commas not inside quotes — naive
  // but adequate for `["a", "b", "c"]`. We never write nested arrays, so a
  // string.split is sufficient.
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner
    .split(',')
    .map((s) => stripQuotes(s).trim())
    .filter((s) => s.length > 0);
}

export function parseFrontmatter(source: string): ParsedFrontmatter {
  const normalized = source.replace(/^\uFEFF/, '');
  // The opening fence must be the very first line — anything else means the
  // file is plain Markdown with no frontmatter to consume.
  if (!normalized.startsWith('---')) {
    return { body: normalized };
  }
  const lines = normalized.split(/\r?\n/);
  // Find the closing fence (the next standalone `---` line).
  let endLine = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      endLine = i;
      break;
    }
  }
  if (endLine === -1) {
    return { body: normalized };
  }

  const result: ParsedFrontmatter = { body: lines.slice(endLine + 1).join('\n').replace(/^\n+/, '') };

  for (let i = 1; i < endLine; i += 1) {
    const line = lines[i] ?? '';
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1).trim();
    if (!key || !rawValue) continue;

    switch (key) {
      case 'title':
        result.title = stripQuotes(rawValue);
        break;
      case 'description':
        result.description = stripQuotes(rawValue);
        break;
      case 'date':
        result.date = stripQuotes(rawValue);
        break;
      case 'author':
        result.author = stripQuotes(rawValue);
        break;
      case 'tags':
        if (rawValue.startsWith('[')) {
          result.tags = parseInlineArray(rawValue);
        }
        break;
      default:
        // Unknown key — ignore. The form lets the operator add anything we
        // don't recognise by hand.
        break;
    }
  }

  return result;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    // Drop diacritics so "wkb-uitlégging" becomes "wkb-uitlegging" not
    // "wkb-uitl-gging".
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}
