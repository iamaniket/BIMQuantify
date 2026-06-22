/**
 * Renders the Dossier bevoegd gezag PDF (#33) — the full evidence bundle for
 * the gereedmelding. Sections: cover, table of contents, risicobeoordeling,
 * borgingsplan, bevindingen (with embedded resolution photos), certificaten,
 * and the verklaring note. PDF certificates + the signed verklaring are merged
 * onto the end by the orchestrator's postProcess (pdf-lib).
 *
 * Photos arrive as `{storage_key, content_type}`; the orchestrator's `prepare`
 * downloads each from MinIO and fills `data_url`, which this template embeds.
 */

import { layout } from './_layout.js';
import {
  addressLine,
  buildMergeContext,
  escapeHtml,
  fmtDate,
  fmtDay,
  or,
  renderSections,
  toLayoutBranding,
  type ContentSectionRender,
  type ReportProject,
  type ReportTemplate,
} from './_helpers.js';
import type { AssuranceMoment, AssuranceRisk } from './assurance-plan.js';
import { NL_DOSSIER_LABELS, type DossierLabels } from './jurisdictions/nl/dossier-labels.js';
import { EN_DOSSIER_LABELS } from './jurisdictions/en/dossier-labels.js';

export type DossierPhoto = { storage_key: string; content_type: string; data_url?: string };

export type DossierFinding = {
  title: string;
  description: string;
  severity: string;
  status: string;
  deadline_date?: string | null;
  bbl_article_ref?: string | null;
  resolution_note?: string | null;
  // Anchored BIM element identity + location (the "snap" GUID/location).
  linked_element_global_id?: string | null;
  linked_model_id?: string | null;
  linked_file_type?: string | null;
  anchor_page?: number | null;
  anchor_x?: number | null;
  anchor_y?: number | null;
  anchor_z?: number | null;
  photos: DossierPhoto[];
};

export type DossierCertificate = {
  certificate_type: string;
  certificate_number?: string | null;
  issuer?: string | null;
  subject?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  filename: string;
  content_type: string;
  storage_key: string;
};

export type DossierData = {
  report_id: string;
  generated_at: string;
  locale: string;
  jurisdiction?: string;
  project: ReportProject;
  assurance_plan: {
    version_number: number;
    status: string;
    created_by?: string | null;
    moments: AssuranceMoment[];
  } | null;
  risks: AssuranceRisk[];
  findings: DossierFinding[];
  certificates: DossierCertificate[];
  verklaring: { storage_key: string; content_type: string; signature_hash?: string | null } | null;
  template?: ReportTemplate;
};

const LABELS_BY_LOCALE: Record<string, DossierLabels> = {
  nl: NL_DOSSIER_LABELS,
  en: EN_DOSSIER_LABELS,
};

function resolveLabels(locale: string | undefined | null): DossierLabels {
  if (locale) {
    const found = LABELS_BY_LOCALE[locale.toLowerCase()];
    if (found) return found;
  }
  return NL_DOSSIER_LABELS;
}

function map(dict: Record<string, string>, key: string): string {
  return dict[key] ?? key;
}

function pill(value: string, label: string): string {
  const cls = value === 'high' ? 'pill pill-fail' : value === 'medium' ? 'pill pill-warn' : 'pill';
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

function renderRisks(risks: AssuranceRisk[], labels: DossierLabels): string {
  if (risks.length === 0) return `<p class="muted">${labels.noRisks}</p>`;
  const rows = risks
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(map(labels.riskCategories, r.category))}</td>
        <td>${pill(r.level, map(labels.riskLevels, r.level))}</td>
        <td>${or(r.description)}</td>
        <td>${or(r.mitigation)}</td>
        <td>${or(r.bbl_article_ref)}</td>
      </tr>`,
    )
    .join('');
  return `<table class="grid"><thead><tr>
      <th>${labels.category}</th><th>${labels.level}</th><th>${labels.riskDescription}</th>
      <th>${labels.mitigation}</th><th>${labels.article}</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMoments(moments: AssuranceMoment[], labels: DossierLabels): string {
  if (moments.length === 0) return `<p class="muted">${labels.noMoments}</p>`;
  const rows = moments
    .map(
      (m) => `
      <tr>
        <td>${escapeHtml(map(labels.phases, m.phase))}</td>
        <td>${or(m.name)}</td>
        <td>${fmtDay(m.planned_date)}</td>
        <td>${fmtDay(m.actual_date)}</td>
      </tr>`,
    )
    .join('');
  return `<table class="grid"><thead><tr>
      <th>Fase</th><th>Moment</th><th>${labels.plannedDate}</th><th>${labels.actualDate}</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPhotos(photos: DossierPhoto[]): string {
  const withData = photos.filter((p) => p.data_url);
  if (withData.length === 0) return '';
  const figs = withData
    .map((p) => `<figure><img src="${p.data_url ?? ''}" alt="" /></figure>`)
    .join('');
  return `<div class="photo-grid">${figs}</div>`;
}

/** The anchored BIM element + location line for a finding ("snap"), if any. */
function findingLocation(f: DossierFinding, labels: DossierLabels): string {
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

function renderFindings(findings: DossierFinding[], labels: DossierLabels): string {
  if (findings.length === 0) return `<p class="muted">${labels.noFindings}</p>`;
  return findings
    .map(
      (f) => `
      <div class="finding">
        <h3>${or(f.title)}</h3>
        <p class="muted">
          ${labels.severity}: ${pill(f.severity, map(labels.findingSeverities, f.severity))}
          &nbsp;·&nbsp; ${labels.findingStatus}: ${escapeHtml(map(labels.findingStatuses, f.status))}
          ${f.deadline_date ? `&nbsp;·&nbsp; ${labels.deadline}: ${fmtDay(f.deadline_date)}` : ''}
          ${f.bbl_article_ref ? `&nbsp;·&nbsp; ${escapeHtml(f.bbl_article_ref)}` : ''}
        </p>
        ${findingLocation(f, labels)}
        <p>${or(f.description)}</p>
        ${f.resolution_note ? `<p><strong>${labels.resolution}:</strong> ${or(f.resolution_note)}</p>` : ''}
        ${renderPhotos(f.photos)}
      </div>`,
    )
    .join('');
}

function renderCertificates(certs: DossierCertificate[], labels: DossierLabels): string {
  if (certs.length === 0) return `<p class="muted">${labels.noCertificates}</p>`;
  const rows = certs
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(map(labels.certTypes, c.certificate_type))}</td>
        <td>${or(c.certificate_number)}</td>
        <td>${or(c.issuer)}</td>
        <td>${fmtDay(c.valid_until)}</td>
        <td>${or(c.filename)}</td>
      </tr>`,
    )
    .join('');
  const note = certs.some((c) => c.content_type === 'application/pdf')
    ? `<p class="muted">${labels.certificatesAttachedNote}</p>`
    : '';
  return `<table class="grid"><thead><tr>
      <th>${labels.certType}</th><th>${labels.certNumber}</th><th>${labels.issuer}</th>
      <th>${labels.validUntil}</th><th>Bestand</th>
    </tr></thead><tbody>${rows}</tbody></table>${note}`;
}

function renderDeclaration(data: DossierData, labels: DossierLabels): string {
  if (data.verklaring) {
    return `
      <p>${labels.declarationAttached}</p>
      <div class="signed-stamp">
        <div>${labels.auditHash}:</div>
        <div class="hash">${or(data.verklaring.signature_hash)}</div>
      </div>`;
  }
  return `<p class="muted">${labels.declarationMissing}</p>`;
}

export function renderHtml(data: DossierData): string {
  const labels = resolveLabels(data.locale);

  const cover = `
    <header class="cover">
      <p class="kicker">${labels.kicker}</p>
      <h1>${labels.reportTitle}</h1>
      <dl class="meta">
        <dt>Project</dt><dd>${or(data.project.name)}</dd>
        <dt>${labels.reference}</dt><dd>${or(data.project.reference_code)}</dd>
        <dt>${labels.address}</dt><dd>${addressLine(data.project.address)}</dd>
        <dt>${labels.generatedAt}</dt><dd>${fmtDate(data.generated_at)}</dd>
      </dl>
      <div class="toc">
        <h2>${labels.toc}</h2>
        <ul>
          <li>${labels.sectionRisks}</li>
          <li>${labels.sectionPlan}</li>
          <li>${labels.sectionFindings}</li>
          <li>${labels.sectionCertificates}</li>
          <li>${labels.sectionDeclaration}</li>
        </ul>
      </div>
    </header>`;

  const content: ContentSectionRender[] = [
    { key: 'risks', defaultTitle: labels.sectionRisks, html: renderRisks(data.risks, labels) },
    {
      key: 'plan',
      defaultTitle: labels.sectionPlan,
      html: data.assurance_plan
        ? renderMoments(data.assurance_plan.moments, labels)
        : `<p class="muted">${labels.noMoments}</p>`,
    },
    {
      key: 'findings',
      defaultTitle: labels.sectionFindings,
      html: renderFindings(data.findings, labels),
    },
    {
      key: 'certificates',
      defaultTitle: labels.sectionCertificates,
      html: renderCertificates(data.certificates, labels),
    },
    {
      key: 'declaration',
      defaultTitle: labels.sectionDeclaration,
      html: renderDeclaration(data, labels),
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
