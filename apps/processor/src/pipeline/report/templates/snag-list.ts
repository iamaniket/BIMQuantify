/**
 * Renders the per-recipient snag-list PDF (#G2) — the bevindingen a contractor
 * hands to a subcontractor. Cover (project + recipient + selection), then the
 * findings grouped by status, each with severity / deadline / Bbl ref /
 * location / description / resolution note and embedded photos (with their
 * capture timestamp — the standard field-evidence pattern).
 *
 * Photos arrive as `{storage_key, content_type, captured_at}`; the
 * orchestrator's `prepare` downloads each from MinIO and fills `data_url`,
 * which this template embeds.
 */

import { layout } from './_layout.js';
import {
  addressLine,
  buildMergeContext,
  escapeHtml,
  fmtDate,
  fmtDay,
  IMAGE_DATA_URL,
  or,
  renderSections,
  toLayoutBranding,
  type ContentSectionRender,
  type ReportProject,
  type ReportTemplate,
} from './_helpers.js';
import { NL_SNAG_LIST_LABELS, type SnagListLabels } from './jurisdictions/nl/snag-list-labels.js';
import { EN_SNAG_LIST_LABELS } from './jurisdictions/en/snag-list-labels.js';

export type SnagPhoto = {
  storage_key: string;
  content_type: string;
  captured_at?: string | null;
  data_url?: string;
};

export type SnagFinding = {
  title: string;
  description: string;
  severity: string;
  status: string;
  assignee?: string | null;
  deadline_date?: string | null;
  bbl_article_ref?: string | null;
  resolution_note?: string | null;
  created_at?: string | null;
  // Anchored BIM element identity + location (the "snap" GUID/location).
  linked_element_global_id?: string | null;
  linked_file_type?: string | null;
  anchor_page?: number | null;
  anchor_x?: number | null;
  anchor_y?: number | null;
  anchor_z?: number | null;
  photos: SnagPhoto[];
};

export type SnagListData = {
  report_id: string;
  generated_at: string;
  locale: string;
  jurisdiction?: string;
  project: ReportProject;
  findings: SnagFinding[];
  recipient: { name?: string | null; email?: string | null } | null;
  filters: { status?: string | null; severity?: string | null };
  template?: ReportTemplate;
};

const LABELS_BY_LOCALE: Record<string, SnagListLabels> = {
  nl: NL_SNAG_LIST_LABELS,
  en: EN_SNAG_LIST_LABELS,
};

// The order statuses are grouped in the report — outstanding work first, the
// verified/closed tail last. Any unknown status falls through to the end.
const STATUS_ORDER = ['open', 'in_progress', 'resolved', 'verified', 'draft'] as const;

function resolveLabels(locale: string | undefined | null): SnagListLabels {
  if (locale) {
    const found = LABELS_BY_LOCALE[locale.toLowerCase()];
    if (found) return found;
  }
  return NL_SNAG_LIST_LABELS;
}

function map(dict: Record<string, string>, key: string): string {
  return dict[key] ?? key;
}

function pill(value: string, label: string): string {
  const cls = value === 'high' ? 'pill pill-fail' : value === 'medium' ? 'pill pill-warn' : 'pill';
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

/** The anchored BIM element + location line for a finding ("snap"), if any. */
function findingLocation(f: SnagFinding, labels: SnagListLabels): string {
  const parts: string[] = [];
  if (f.linked_element_global_id) {
    parts.push(`${labels.element}: ${escapeHtml(f.linked_element_global_id)}`);
  }
  if (f.linked_file_type === 'pdf' && f.anchor_page != null) {
    parts.push(`${labels.page} ${f.anchor_page}`);
  } else if (f.anchor_x != null && f.anchor_y != null) {
    const coords =
      f.linked_file_type === 'ifc' && f.anchor_z != null
        ? `${f.anchor_x.toFixed(2)}, ${f.anchor_y.toFixed(2)}, ${f.anchor_z.toFixed(2)}`
        : `${f.anchor_x.toFixed(2)}, ${f.anchor_y.toFixed(2)}`;
    parts.push(`${labels.location}: ${coords}`);
  }
  return parts.length > 0 ? `<p class="muted">${parts.join(' &nbsp;·&nbsp; ')}</p>` : '';
}

function renderPhotos(photos: SnagPhoto[], labels: SnagListLabels): string {
  // Only embed data URLs that match the safe base64-image shape (defence in depth
  // over safeImageDataUrl at prepare time); escapeHtml the value regardless so a
  // future regression can't break out of the src attribute (SEAM-XSS-SSRF-1).
  const withData = photos.filter((p) => p.data_url && IMAGE_DATA_URL.test(p.data_url));
  if (withData.length === 0) return '';
  const figs = withData
    .map((p) => {
      const caption = p.captured_at
        ? `<figcaption class="muted">${labels.capturedAt}: ${fmtDate(p.captured_at)}</figcaption>`
        : '';
      return `<figure><img src="${escapeHtml(p.data_url ?? '')}" alt="" />${caption}</figure>`;
    })
    .join('');
  return `<div class="photo-grid">${figs}</div>`;
}

function renderFinding(f: SnagFinding, labels: SnagListLabels): string {
  return `
    <div class="finding">
      <h3>${or(f.title)}</h3>
      <p class="muted">
        ${labels.severity}: ${pill(f.severity, map(labels.findingSeverities, f.severity))}
        &nbsp;·&nbsp; ${labels.findingStatus}: ${escapeHtml(map(labels.findingStatuses, f.status))}
        ${f.assignee ? `&nbsp;·&nbsp; ${labels.assignee}: ${escapeHtml(f.assignee)}` : ''}
        ${f.deadline_date ? `&nbsp;·&nbsp; ${labels.deadline}: ${fmtDay(f.deadline_date)}` : ''}
        ${f.bbl_article_ref ? `&nbsp;·&nbsp; ${escapeHtml(f.bbl_article_ref)}` : ''}
      </p>
      ${findingLocation(f, labels)}
      <p>${or(f.description)}</p>
      ${f.resolution_note ? `<p><strong>${labels.resolution}:</strong> ${or(f.resolution_note)}</p>` : ''}
      ${renderPhotos(f.photos, labels)}
    </div>`;
}

function renderFindings(findings: SnagFinding[], labels: SnagListLabels): string {
  if (findings.length === 0) return `<p class="muted">${labels.noFindings}</p>`;
  // Group by status in the canonical order; only render non-empty groups.
  const byStatus = new Map<string, SnagFinding[]>();
  for (const f of findings) {
    const bucket = byStatus.get(f.status) ?? [];
    bucket.push(f);
    byStatus.set(f.status, bucket);
  }
  const orderedKeys = [
    ...STATUS_ORDER.filter((s) => byStatus.has(s)),
    ...[...byStatus.keys()].filter((s) => !STATUS_ORDER.includes(s as (typeof STATUS_ORDER)[number])),
  ];
  return orderedKeys
    .map((statusKey) => {
      const group = byStatus.get(statusKey) ?? [];
      const heading = `${map(labels.findingStatuses, statusKey)} (${group.length})`;
      return `<div class="status-group">
        <h2 class="status-heading">${escapeHtml(heading)}</h2>
        ${group.map((f) => renderFinding(f, labels)).join('')}
      </div>`;
    })
    .join('');
}

/** Cover meta entries describing the report's selection (recipient + filters). */
function scopeLines(data: SnagListData, labels: SnagListLabels): string {
  const rows: string[] = [];
  if (data.recipient && (data.recipient.name || data.recipient.email)) {
    const email = data.recipient.email ? ` (${escapeHtml(data.recipient.email)})` : '';
    rows.push(`<dt>${labels.recipient}</dt><dd>${or(data.recipient.name)}${email}</dd>`);
  }
  const filters: string[] = [];
  if (data.filters.status) {
    filters.push(`${labels.filterStatus}: ${map(labels.findingStatuses, data.filters.status)}`);
  }
  if (data.filters.severity) {
    filters.push(`${labels.filterSeverity}: ${map(labels.findingSeverities, data.filters.severity)}`);
  }
  const scopeText = filters.length > 0 ? filters.join(' · ') : labels.scopeAll;
  rows.push(`<dt>${labels.scope}</dt><dd>${escapeHtml(scopeText)}</dd>`);
  return rows.join('');
}

export function renderHtml(data: SnagListData): string {
  const labels = resolveLabels(data.locale);

  const cover = `
    <header class="cover">
      <p class="kicker">${labels.kicker}</p>
      <h1>${labels.reportTitle}</h1>
      <dl class="meta">
        <dt>Project</dt><dd>${or(data.project.name)}</dd>
        <dt>${labels.reference}</dt><dd>${or(data.project.reference_code)}</dd>
        <dt>${labels.address}</dt><dd>${addressLine(data.project.address)}</dd>
        ${scopeLines(data, labels)}
        <dt>${labels.generatedAt}</dt><dd>${fmtDate(data.generated_at)}</dd>
      </dl>
    </header>`;

  const content: ContentSectionRender[] = [
    {
      key: 'findings',
      defaultTitle: labels.sectionFindings,
      html: renderFindings(data.findings, labels),
    },
  ];
  const body = renderSections(content, data.template?.sections, buildMergeContext(data));

  return layout({
    title: `${labels.reportTitle} — ${or(data.project.name)}`,
    generatedAt: fmtDate(data.generated_at),
    body: cover + body,
    locale: data.locale,
    branding: toLayoutBranding(data.template?.branding),
  });
}
