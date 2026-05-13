/**
 * Renders a Compliance Report PDF as a complete HTML document.
 *
 * Plain template literals + a tiny escapeHtml helper — deliberately no
 * templating engine yet. Volume is small (a single page kind), and keeping
 * dependencies tight makes the worker image leaner.
 *
 * The compliance JSON shape is the API's `ComplianceCheckResponse` (see
 * `apps/api/src/bimstitch_api/schemas/compliance.py`). Where Dutch text is
 * available (`title_nl`), we prefer it.
 */

import { layout } from './_layout.js';

const NL_LABELS = {
  passed: 'Geslaagd',
  failed: 'Mislukt',
  warned: 'Waarschuwing',
  totalRules: 'Totaal regels',
  totalChecks: 'Totaal controles',
  totalElements: 'Gecontroleerde elementen',
  rule: 'Regel',
  article: 'Artikel',
  category: 'Categorie',
  severity: 'Ernst',
  status: 'Status',
  noResults: 'Geen controleresultaten beschikbaar.',
  generatedAt: 'Gegenereerd op',
  project: 'Project',
  contractor: 'Aannemer',
  address: 'Adres',
  permit: 'Vergunning',
  delivery: 'Opleverdatum',
  reference: 'Projectkenmerk',
  framework: 'Kader',
  overallScore: 'Naleving',
} as const;

export type ComplianceReportData = {
  report_id: string;
  generated_at: string;
  locale: string;
  project: {
    id: string;
    name: string;
    reference_code?: string | null;
    status?: string | null;
    phase?: string | null;
    address?: {
      street?: string | null;
      house_number?: string | null;
      postal_code?: string | null;
      city?: string | null;
      municipality?: string | null;
      bag_id?: string | null;
    } | null;
    permit_number?: string | null;
    delivery_date?: string | null;
    contractor?: {
      name?: string | null;
      kvk_number?: string | null;
      contact_email?: string | null;
      contact_phone?: string | null;
    } | null;
  };
  compliance: {
    framework?: string;
    checked_at?: string;
    total_rules?: number;
    total_elements_checked?: number;
    rules_summary?: Array<{
      rule_id: string;
      article?: string | null;
      title?: string | null;
      title_nl?: string | null;
      category?: string | null;
      severity?: string | null;
      pass_count?: number;
      fail_count?: number;
      warn_count?: number;
      skip_count?: number;
    }>;
    category_summary?: Array<{
      category: string;
      total_rules?: number;
      total_checks?: number;
      passed?: number;
      failed?: number;
      warned?: number;
    }>;
  };
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function or(value: string | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined) return fallback;
  const trimmed = String(value).trim();
  return trimmed === '' ? fallback : escapeHtml(trimmed);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    // Dutch-style date — DD-MM-YYYY HH:MM (utc; the worker has no locale db).
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
    );
  } catch {
    return '—';
  }
}

function addressLine(addr: ComplianceReportData['project']['address']): string {
  if (!addr) return '—';
  const street = [addr.street, addr.house_number].filter(Boolean).join(' ');
  const city = [addr.postal_code, addr.city].filter(Boolean).join(' ');
  const parts = [street, city, addr.municipality].filter((s) => s && String(s).trim() !== '');
  return parts.length === 0 ? '—' : escapeHtml(parts.join(', '));
}

function overallScore(data: ComplianceReportData): {
  pass: number;
  fail: number;
  warn: number;
  total: number;
  percent: number;
} {
  const cats = data.compliance.category_summary ?? [];
  let pass = 0;
  let fail = 0;
  let warn = 0;
  for (const c of cats) {
    pass += c.passed ?? 0;
    fail += c.failed ?? 0;
    warn += c.warned ?? 0;
  }
  const total = pass + fail + warn;
  const percent = total === 0 ? 0 : Math.round((pass / total) * 100);
  return { pass, fail, warn, total, percent };
}

function statusPill(severity: string | null | undefined): string {
  const sev = (severity ?? '').toLowerCase();
  const cls = sev === 'high' ? 'pill pill-fail' : sev === 'medium' ? 'pill pill-warn' : 'pill';
  return `<span class="${cls}">${escapeHtml(sev || 'normal')}</span>`;
}

function renderCategoryTable(data: ComplianceReportData): string {
  const cats = data.compliance.category_summary ?? [];
  if (cats.length === 0) {
    return `<p class="muted">${NL_LABELS.noResults}</p>`;
  }
  const rows = cats
    .map(
      (c) => `
      <tr>
        <td>${or(c.category)}</td>
        <td class="num">${c.total_rules ?? 0}</td>
        <td class="num">${c.total_checks ?? 0}</td>
        <td class="num pass">${c.passed ?? 0}</td>
        <td class="num warn">${c.warned ?? 0}</td>
        <td class="num fail">${c.failed ?? 0}</td>
      </tr>`,
    )
    .join('');
  return `
    <table class="grid">
      <thead>
        <tr>
          <th>${NL_LABELS.category}</th>
          <th class="num">${NL_LABELS.totalRules}</th>
          <th class="num">${NL_LABELS.totalChecks}</th>
          <th class="num">${NL_LABELS.passed}</th>
          <th class="num">${NL_LABELS.warned}</th>
          <th class="num">${NL_LABELS.failed}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRulesTable(data: ComplianceReportData): string {
  const rules = data.compliance.rules_summary ?? [];
  if (rules.length === 0) {
    return `<p class="muted">${NL_LABELS.noResults}</p>`;
  }
  const rows = rules
    .map(
      (r) => `
      <tr>
        <td>${or(r.title_nl ?? r.title)}</td>
        <td>${or(r.article)}</td>
        <td>${or(r.category)}</td>
        <td>${statusPill(r.severity)}</td>
        <td class="num pass">${r.pass_count ?? 0}</td>
        <td class="num warn">${r.warn_count ?? 0}</td>
        <td class="num fail">${r.fail_count ?? 0}</td>
      </tr>`,
    )
    .join('');
  return `
    <table class="grid">
      <thead>
        <tr>
          <th>${NL_LABELS.rule}</th>
          <th>${NL_LABELS.article}</th>
          <th>${NL_LABELS.category}</th>
          <th>${NL_LABELS.severity}</th>
          <th class="num">${NL_LABELS.passed}</th>
          <th class="num">${NL_LABELS.warned}</th>
          <th class="num">${NL_LABELS.failed}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function renderHtml(data: ComplianceReportData): string {
  const score = overallScore(data);
  const cover = `
    <header class="cover">
      <p class="kicker">Nalevingsrapport</p>
      <h1>${or(data.project.name)}</h1>
      <dl class="meta">
        <dt>${NL_LABELS.reference}</dt><dd>${or(data.project.reference_code)}</dd>
        <dt>${NL_LABELS.framework}</dt><dd>${or(data.compliance.framework?.toUpperCase())}</dd>
        <dt>${NL_LABELS.address}</dt><dd>${addressLine(data.project.address)}</dd>
        <dt>${NL_LABELS.contractor}</dt><dd>${or(data.project.contractor?.name)}</dd>
        <dt>${NL_LABELS.permit}</dt><dd>${or(data.project.permit_number)}</dd>
        <dt>${NL_LABELS.delivery}</dt><dd>${or(data.project.delivery_date)}</dd>
        <dt>${NL_LABELS.generatedAt}</dt><dd>${fmtDate(data.generated_at)}</dd>
      </dl>

      <section class="score-card">
        <div class="score-number">${score.percent}<span class="score-unit">%</span></div>
        <div class="score-label">${NL_LABELS.overallScore}</div>
        <div class="score-counts">
          <span class="pass">${score.pass} ${NL_LABELS.passed.toLowerCase()}</span>
          <span class="warn">${score.warn} ${NL_LABELS.warned.toLowerCase()}</span>
          <span class="fail">${score.fail} ${NL_LABELS.failed.toLowerCase()}</span>
        </div>
        <div class="score-totals">
          ${data.compliance.total_rules ?? 0} ${NL_LABELS.totalRules.toLowerCase()},
          ${data.compliance.total_elements_checked ?? 0} ${NL_LABELS.totalElements.toLowerCase()}
        </div>
      </section>
    </header>`;

  const body = `
    <section class="page">
      <h2>Per categorie</h2>
      ${renderCategoryTable(data)}
    </section>

    <section class="page">
      <h2>Per regel</h2>
      ${renderRulesTable(data)}
    </section>`;

  return layout({
    title: `Nalevingsrapport — ${or(data.project.name)}`,
    generatedAt: fmtDate(data.generated_at),
    body: cover + body,
  });
}
