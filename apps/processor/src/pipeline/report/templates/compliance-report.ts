/**
 * Renders a Compliance Report PDF as a complete HTML document.
 *
 * Plain template literals + a tiny escapeHtml helper — deliberately no
 * templating engine yet. Volume is small (a single page kind), and keeping
 * dependencies tight makes the worker image leaner.
 *
 * The compliance JSON shape is the API's `ComplianceCheckResponse` (see
 * `apps/api/src/bimstitch_api/schemas/compliance.py`). Labels come from a
 * per-jurisdiction module under `jurisdictions/<country>/labels.ts` — NL
 * is the default. Adding a second jurisdiction = sibling folder + a
 * registry entry below.
 */

import { layout } from './_layout.js';
import {
  buildMergeContext,
  renderSections,
  toLayoutBranding,
  type ContentSectionRender,
  type ReportTemplate,
} from './_helpers.js';
import { NL_COMPLIANCE_LABELS, type ComplianceReportLabels } from './jurisdictions/nl/labels.js';
import { EN_COMPLIANCE_LABELS } from './jurisdictions/en/labels.js';

const LABELS_BY_LOCALE: Record<string, ComplianceReportLabels> = {
  nl: NL_COMPLIANCE_LABELS,
  en: EN_COMPLIANCE_LABELS,
};

function resolveLabels(locale: string | undefined | null): ComplianceReportLabels {
  if (locale) {
    const found = LABELS_BY_LOCALE[locale.toLowerCase()];
    if (found) return found;
  }
  return NL_COMPLIANCE_LABELS;
}

export type ComplianceReportData = {
  report_id: string;
  generated_at: string;
  locale: string;
  /**
   * ISO 3166-1 alpha-2 country code controlling label selection.
   * Omitted on legacy callers — those default to 'NL'.
   */
  jurisdiction?: string;
  project: {
    id: string;
    name: string;
    country?: string | null;
    reference_code?: string | null;
    status?: string | null;
    phase?: string | null;
    address?: {
      country?: string | null;
      street?: string | null;
      house_number?: string | null;
      postal_code?: string | null;
      city?: string | null;
      municipality?: string | null;
      bag_id?: string | null;
    } | null;
    permit_number?: string | null;
    delivery_date?: string | null;
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
  template?: ReportTemplate;
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

function renderCategoryTable(data: ComplianceReportData, labels: ComplianceReportLabels): string {
  const cats = data.compliance.category_summary ?? [];
  if (cats.length === 0) {
    return `<p class="muted">${labels.noResults}</p>`;
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
          <th>${labels.category}</th>
          <th class="num">${labels.totalRules}</th>
          <th class="num">${labels.totalChecks}</th>
          <th class="num">${labels.passed}</th>
          <th class="num">${labels.warned}</th>
          <th class="num">${labels.failed}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRulesTable(data: ComplianceReportData, labels: ComplianceReportLabels): string {
  const rules = data.compliance.rules_summary ?? [];
  if (rules.length === 0) {
    return `<p class="muted">${labels.noResults}</p>`;
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
          <th>${labels.rule}</th>
          <th>${labels.article}</th>
          <th>${labels.category}</th>
          <th>${labels.severity}</th>
          <th class="num">${labels.passed}</th>
          <th class="num">${labels.warned}</th>
          <th class="num">${labels.failed}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function renderHtml(data: ComplianceReportData): string {
  const score = overallScore(data);
  const labels = resolveLabels(data.locale);
  const cover = `
    <header class="cover">
      <p class="kicker">${labels.reportTitle}</p>
      <h1>${or(data.project.name)}</h1>
      <dl class="meta">
        <dt>${labels.reference}</dt><dd>${or(data.project.reference_code)}</dd>
        <dt>${labels.framework}</dt><dd>${or(data.compliance.framework?.toUpperCase())}</dd>
        <dt>${labels.address}</dt><dd>${addressLine(data.project.address)}</dd>
        <dt>${labels.permit}</dt><dd>${or(data.project.permit_number)}</dd>
        <dt>${labels.delivery}</dt><dd>${or(data.project.delivery_date)}</dd>
        <dt>${labels.generatedAt}</dt><dd>${fmtDate(data.generated_at)}</dd>
      </dl>

      <section class="score-card">
        <div class="score-number">${score.percent}<span class="score-unit">%</span></div>
        <div class="score-label">${labels.overallScore}</div>
        <div class="score-counts">
          <span class="pass">${score.pass} ${labels.passed.toLowerCase()}</span>
          <span class="warn">${score.warn} ${labels.warned.toLowerCase()}</span>
          <span class="fail">${score.fail} ${labels.failed.toLowerCase()}</span>
        </div>
        <div class="score-totals">
          ${data.compliance.total_rules ?? 0} ${labels.totalRules.toLowerCase()},
          ${data.compliance.total_elements_checked ?? 0} ${labels.totalElements.toLowerCase()}
        </div>
      </section>
    </header>`;

  const content: ContentSectionRender[] = [
    {
      key: 'by_category',
      defaultTitle: labels.sectionByCategory,
      html: renderCategoryTable(data, labels),
    },
    { key: 'by_rule', defaultTitle: labels.sectionByRule, html: renderRulesTable(data, labels) },
  ];
  const body = renderSections(
    content,
    data.template?.sections,
    buildMergeContext({ project: data.project, generated_at: data.generated_at }),
  );

  return layout({
    title: `${labels.reportTitle} — ${or(data.project.name)}`,
    generatedAt: fmtDate(data.generated_at),
    body: cover + body,
    locale: data.locale,
    branding: toLayoutBranding(data.template?.branding),
  });
}
