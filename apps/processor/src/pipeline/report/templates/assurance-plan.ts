/**
 * Renders the Borgingsplan PDF (#31) as a complete HTML document.
 *
 * Same plain-template-literal approach as compliance-report.ts, sharing the
 * `_helpers` + `_layout` + per-jurisdiction labels. Sections: cover (project +
 * kwaliteitsborger + instrument), risicobeoordeling table, borgingsmomenten
 * (grouped by phase, each with its checklist items), and a signature block.
 */

import { layout } from './_layout.js';
import {
  addressLine,
  escapeHtml,
  fmtDate,
  fmtDay,
  or,
  type ReportInstrument,
  type ReportProject,
} from './_helpers.js';
import {
  NL_ASSURANCE_PLAN_LABELS,
  type AssurancePlanLabels,
} from './jurisdictions/nl/assurance-plan-labels.js';

export type AssuranceChecklistItem = {
  description: string;
  evidence_type: string;
  bbl_article_ref?: string | null;
  pass_fail_criteria?: string | null;
};

export type AssuranceMoment = {
  phase: string;
  name: string;
  planned_date: string;
  actual_date?: string | null;
  responsible?: string | null;
  status: string;
  checklist_items: AssuranceChecklistItem[];
};

export type AssuranceRisk = {
  category: string;
  level: string;
  description: string;
  mitigation: string;
  responsible_party?: string | null;
  bbl_article_ref?: string | null;
};

export type AssurancePlanData = {
  report_id: string;
  generated_at: string;
  locale: string;
  jurisdiction?: string;
  project: ReportProject;
  instrument: ReportInstrument | null;
  assurance_plan: {
    version_number: number;
    status: string;
    created_by?: string | null;
    published_at?: string | null;
    notes?: string | null;
    moments: AssuranceMoment[];
  };
  risks: AssuranceRisk[];
};

const LABELS_BY_JURISDICTION: Record<string, AssurancePlanLabels> = {
  NL: NL_ASSURANCE_PLAN_LABELS,
};

function resolveLabels(jurisdiction: string | undefined | null): AssurancePlanLabels {
  if (jurisdiction) {
    const found = LABELS_BY_JURISDICTION[jurisdiction.toUpperCase()];
    if (found) return found;
  }
  return NL_ASSURANCE_PLAN_LABELS;
}

function map(dict: Record<string, string>, key: string): string {
  return dict[key] ?? key;
}

function levelPill(level: string, labels: AssurancePlanLabels): string {
  const cls = level === 'high' ? 'pill pill-fail' : level === 'medium' ? 'pill pill-warn' : 'pill';
  return `<span class="${cls}">${escapeHtml(map(labels.riskLevels, level))}</span>`;
}

function renderRisks(risks: AssuranceRisk[], labels: AssurancePlanLabels): string {
  if (risks.length === 0) return `<p class="muted">${labels.noRisks}</p>`;
  const rows = risks
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(map(labels.riskCategories, r.category))}</td>
        <td>${levelPill(r.level, labels)}</td>
        <td>${or(r.description)}</td>
        <td>${or(r.mitigation)}</td>
        <td>${or(r.responsible_party)}</td>
        <td>${or(r.bbl_article_ref)}</td>
      </tr>`,
    )
    .join('');
  return `
    <table class="grid">
      <thead>
        <tr>
          <th>${labels.category}</th>
          <th>${labels.level}</th>
          <th>${labels.riskDescription}</th>
          <th>${labels.mitigation}</th>
          <th>${labels.responsibleParty}</th>
          <th>${labels.article}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderChecklist(items: AssuranceChecklistItem[], labels: AssurancePlanLabels): string {
  if (items.length === 0) return '';
  const rows = items
    .map(
      (ci) => `
      <tr>
        <td>${or(ci.description)}</td>
        <td>${escapeHtml(map(labels.evidenceTypes, ci.evidence_type))}</td>
        <td>${or(ci.pass_fail_criteria)}</td>
        <td>${or(ci.bbl_article_ref)}</td>
      </tr>`,
    )
    .join('');
  return `
    <table class="grid">
      <thead>
        <tr>
          <th>${labels.checklistItem}</th>
          <th>${labels.evidence}</th>
          <th>${labels.criteria}</th>
          <th>${labels.article}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderMoments(moments: AssuranceMoment[], labels: AssurancePlanLabels): string {
  if (moments.length === 0) return `<p class="muted">${labels.noMoments}</p>`;
  return moments
    .map(
      (m) => `
      <div class="moment">
        <h3>${escapeHtml(map(labels.phases, m.phase))} · ${or(m.name)}</h3>
        <dl class="meta meta-inline">
          <dt>${labels.plannedDate}</dt><dd>${fmtDay(m.planned_date)}</dd>
          <dt>${labels.actualDate}</dt><dd>${fmtDay(m.actual_date)}</dd>
          <dt>${labels.responsible}</dt><dd>${or(m.responsible)}</dd>
        </dl>
        ${renderChecklist(m.checklist_items, labels)}
      </div>`,
    )
    .join('');
}

function signatureBlock(labels: AssurancePlanLabels): string {
  return `
    <section class="page signature">
      <h2>${labels.signatureTitle}</h2>
      <dl class="meta sign-grid">
        <dt>${labels.signatureName}</dt><dd class="sign-line"></dd>
        <dt>${labels.signatureDate}</dt><dd class="sign-line"></dd>
        <dt>${labels.signatureSignature}</dt><dd class="sign-line sign-tall"></dd>
      </dl>
    </section>`;
}

export function renderHtml(data: AssurancePlanData): string {
  const labels = resolveLabels(data.jurisdiction ?? data.project.country ?? 'NL');
  const plan = data.assurance_plan;
  const instrumentText = data.instrument
    ? `${escapeHtml(data.instrument.name)}${
        data.instrument.provider ? ` · ${escapeHtml(data.instrument.provider)}` : ''
      }`
    : '—';

  const cover = `
    <header class="cover">
      <p class="kicker">${labels.reportTitle}</p>
      <h1>${or(data.project.name)}</h1>
      <dl class="meta">
        <dt>${labels.reference}</dt><dd>${or(data.project.reference_code)}</dd>
        <dt>${labels.address}</dt><dd>${addressLine(data.project.address)}</dd>
        <dt>${labels.instrument}</dt><dd>${instrumentText}</dd>
        <dt>${labels.kwaliteitsborger}</dt><dd>${or(plan.created_by)}</dd>
        <dt>${labels.version}</dt><dd>v${String(plan.version_number)} · ${escapeHtml(
          map(labels.planStatus, plan.status),
        )}</dd>
        <dt>${labels.generatedAt}</dt><dd>${fmtDate(data.generated_at)}</dd>
      </dl>
    </header>`;

  const body = `
    <section class="page">
      <h2>${labels.sectionRisks}</h2>
      ${renderRisks(data.risks, labels)}
    </section>

    <section class="page">
      <h2>${labels.sectionMoments}</h2>
      ${renderMoments(plan.moments, labels)}
    </section>

    ${signatureBlock(labels)}`;

  return layout({
    title: `${labels.reportTitle} — ${or(data.project.name)}`,
    generatedAt: fmtDate(data.generated_at),
    body: cover + body,
  });
}
