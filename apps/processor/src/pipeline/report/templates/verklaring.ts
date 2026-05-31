/**
 * Renders the Verklaring kwaliteitsborger PDF (#32).
 *
 * Short, formal declaration. Generated unsigned (signature placeholder block);
 * once an inspector signs (API re-renders with `declaration.signed=true`), the
 * placeholder is replaced by a stamped block carrying the signer + audit-id
 * hash. The declaration text is a concept (see verklaring-labels.ts).
 */

import { layout } from './_layout.js';
import {
  addressLine,
  escapeHtml,
  fmtDate,
  or,
  type ReportInstrument,
  type ReportProject,
} from './_helpers.js';
import {
  NL_VERKLARING_LABELS,
  type VerklaringLabels,
} from './jurisdictions/nl/verklaring-labels.js';

export type VerklaringData = {
  report_id: string;
  generated_at: string;
  locale: string;
  jurisdiction?: string;
  project: ReportProject;
  instrument: ReportInstrument | null;
  declaration: {
    kwaliteitsborger?: string | null;
    kwaliteitsborger_email?: string | null;
    signed: boolean;
    signed_at?: string | null;
    signature_hash?: string | null;
  };
};

const LABELS_BY_JURISDICTION: Record<string, VerklaringLabels> = {
  NL: NL_VERKLARING_LABELS,
};

function resolveLabels(jurisdiction: string | undefined | null): VerklaringLabels {
  if (jurisdiction) {
    const found = LABELS_BY_JURISDICTION[jurisdiction.toUpperCase()];
    if (found) return found;
  }
  return NL_VERKLARING_LABELS;
}

/** Fill {placeholders} from a map of already-escaped values. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? '');
}

function signatureSection(data: VerklaringData, labels: VerklaringLabels): string {
  const d = data.declaration;
  if (d.signed) {
    return `
      <section class="page signature">
        <h2>${labels.signedStampTitle}</h2>
        <div class="signed-stamp">
          <div>${labels.signedBy}: <strong>${or(d.kwaliteitsborger)}</strong></div>
          <div>${labels.signedOn}: <strong>${fmtDate(d.signed_at)}</strong></div>
          <div>${labels.auditHash}:</div>
          <div class="hash">${or(d.signature_hash)}</div>
        </div>
      </section>`;
  }
  return `
    <section class="page signature">
      <h2>${labels.signatureTitle}</h2>
      <p class="muted">${labels.unsignedNotice}</p>
      <dl class="meta sign-grid">
        <dt>${labels.signatureName}</dt><dd class="sign-line"></dd>
        <dt>${labels.signatureDate}</dt><dd class="sign-line"></dd>
        <dt>${labels.signatureSignature}</dt><dd class="sign-line sign-tall"></dd>
      </dl>
    </section>`;
}

export function renderHtml(data: VerklaringData): string {
  const labels = resolveLabels(data.jurisdiction ?? data.project.country ?? 'NL');
  const instrumentText = data.instrument
    ? `${escapeHtml(data.instrument.name)}${
        data.instrument.provider ? ` · ${escapeHtml(data.instrument.provider)}` : ''
      }`
    : '—';

  const cover = `
    <header class="cover">
      <p class="kicker">${labels.kicker}</p>
      <h1>${labels.reportTitle}</h1>
      <dl class="meta">
        <dt>${labels.kwaliteitsborger}</dt><dd>${or(data.declaration.kwaliteitsborger)}</dd>
        <dt>${labels.instrument}</dt><dd>${instrumentText}</dd>
        <dt>${labels.address}</dt><dd>${addressLine(data.project.address)}</dd>
        <dt>${labels.reference}</dt><dd>${or(data.project.reference_code)}</dd>
        <dt>${labels.generatedAt}</dt><dd>${fmtDate(data.generated_at)}</dd>
      </dl>
    </header>`;

  const bodyText = fill(labels.declarationBody, {
    kb: or(data.declaration.kwaliteitsborger),
    instrument: data.instrument ? escapeHtml(data.instrument.name) : '—',
    address: addressLine(data.project.address),
  });

  const body = `
    <section class="page">
      <h2>${labels.declarationHeading}</h2>
      <div class="declaration"><p>${bodyText}</p></div>
      <p class="muted">${labels.draftNotice}</p>
    </section>
    ${signatureSection(data, labels)}`;

  return layout({
    title: `${labels.reportTitle} — ${or(data.project.name)}`,
    generatedAt: fmtDate(data.generated_at),
    body: cover + body,
  });
}
