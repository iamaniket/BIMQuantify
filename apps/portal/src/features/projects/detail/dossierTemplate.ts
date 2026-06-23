import type { JurisdictionDossierRequirement } from '@/lib/api/jurisdictions';
import type { Attachment } from '@/lib/api/schemas/attachments';
import type { Certificate } from '@/lib/api/schemas/certificates';

import { getCertificateExpiryState } from '@/features/certificates/expiry';

/** A resolved checklist requirement: a jurisdiction template + its met/missing state. */
export type DossierRequirementResult = {
  code: string;
  category: string;
  label: string;
  required: boolean;
  sourceKind: JurisdictionDossierRequirement['source_kind'];
  sourceValue: string;
  fulfilled: boolean;
  count: number;
  hasExpiredCert: boolean;
};

/** Requirements grouped under one localized category header. */
type DossierCategoryGroup = {
  category: string;
  requirements: DossierRequirementResult[];
  filled: number;
  total: number;
};

export type DossierCompleteness = {
  /** Required-only counts drive the headline percentage. */
  filled: number;
  total: number;
  pct: number;
  /** Optional items that are met — surfaced separately so they don't dilute pct. */
  optionalFilled: number;
  optionalTotal: number;
  requirements: DossierRequirementResult[];
  groups: DossierCategoryGroup[];
};

type DossierDerivedInput = {
  /** Total non-deleted models (drives the `derived`/`models` signal). */
  modelCount?: number;
  /** Models with at least one viewable/processed file (drives `model`-kind). */
  viewableModelCount?: number;
  findingsOpen?: number;
  deadlinesOverdue?: number;
};

function resolveFulfillment(
  req: JurisdictionDossierRequirement,
  readyAttachments: Attachment[],
  readyCertificates: Certificate[],
  derived: Required<DossierDerivedInput>,
): { fulfilled: boolean; count: number; hasExpiredCert: boolean } {
  switch (req.source_kind) {
    case 'attachment_slot': {
      const count = readyAttachments.filter((a) => a.dossier_slot === req.source_value).length;
      return { fulfilled: count > 0, count, hasExpiredCert: false };
    }
    case 'certificate_type': {
      const matching = readyCertificates.filter(
        (c) => c.certificate_type === req.source_value,
      );
      const hasExpiredCert = matching.some((c) => {
        const state = getCertificateExpiryState(c.valid_until);
        return state === 'expired' || state === 'expiring';
      });
      return { fulfilled: matching.length > 0, count: matching.length, hasExpiredCert };
    }
    case 'model': {
      // Drawings: satisfied by a viewable/processed model (ready+extracted IFC
      // or ready PDF) — the geometry the per-storey 2D plans derive from. A
      // model that exists but is still processing does not count.
      return {
        fulfilled: derived.viewableModelCount > 0,
        count: derived.viewableModelCount,
        hasExpiredCert: false,
      };
    }
    case 'derived': {
      switch (req.source_value) {
        case 'models':
          return { fulfilled: derived.modelCount > 0, count: derived.modelCount, hasExpiredCert: false };
        case 'findings':
          return { fulfilled: derived.findingsOpen === 0, count: derived.findingsOpen, hasExpiredCert: false };
        case 'deadlines':
          return { fulfilled: derived.deadlinesOverdue === 0, count: derived.deadlinesOverdue, hasExpiredCert: false };
        default:
          return { fulfilled: false, count: 0, hasExpiredCert: false };
      }
    }
    default:
      return { fulfilled: false, count: 0, hasExpiredCert: false };
  }
}

/**
 * Resolve a jurisdiction's dossier requirement template against the project's
 * tagged documents, typed certificates, and derived signals (models / findings
 * / deadlines). Required items drive the headline percentage; optional items
 * (e.g. KB-documenten before a kwaliteitsborger joins) are tracked separately.
 *
 * `template` is the per-building-type list from
 * `Jurisdiction.dossier_requirement_templates` — the caller selects the right
 * building-type slice (see `selectDossierTemplate`).
 */
export function computeDossierCompleteness(
  template: JurisdictionDossierRequirement[],
  attachments: Attachment[],
  certificates: Certificate[],
  derived: DossierDerivedInput = {},
): DossierCompleteness {
  const filled0: Required<DossierDerivedInput> = {
    modelCount: derived.modelCount ?? 0,
    viewableModelCount: derived.viewableModelCount ?? 0,
    findingsOpen: derived.findingsOpen ?? 0,
    deadlinesOverdue: derived.deadlinesOverdue ?? 0,
  };

  const readyAttachments = attachments.filter((a) => a.status === 'ready');
  const readyCertificates = certificates.filter((c) => c.status === 'ready');

  const requirements: DossierRequirementResult[] = template.map((req) => {
    const { fulfilled, count, hasExpiredCert } = resolveFulfillment(
      req,
      readyAttachments,
      readyCertificates,
      filled0,
    );
    return {
      code: req.code,
      category: req.category,
      label: req.label,
      required: req.required,
      sourceKind: req.source_kind,
      sourceValue: req.source_value,
      fulfilled,
      count,
      hasExpiredCert,
    };
  });

  // Group by category, preserving first-seen order.
  const order: string[] = [];
  const byCategory = new Map<string, DossierRequirementResult[]>();
  for (const r of requirements) {
    if (!byCategory.has(r.category)) {
      byCategory.set(r.category, []);
      order.push(r.category);
    }
    byCategory.get(r.category)?.push(r);
  }
  const groups: DossierCategoryGroup[] = order.map((category) => {
    const reqs = byCategory.get(category) ?? [];
    return {
      category,
      requirements: reqs,
      filled: reqs.filter((r) => r.fulfilled).length,
      total: reqs.length,
    };
  });

  const required = requirements.filter((r) => r.required);
  const optional = requirements.filter((r) => !r.required);
  const filled = required.filter((r) => r.fulfilled).length;
  const total = required.length;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 100;

  return {
    filled,
    total,
    pct,
    optionalFilled: optional.filter((r) => r.fulfilled).length,
    optionalTotal: optional.length,
    requirements,
    groups,
  };
}

/**
 * Pick the requirement set for a building type, falling back to "other" (and
 * then any available set) — mirrors the API's `get_dossier_requirements`.
 */
export function selectDossierTemplate(
  templates: Record<string, JurisdictionDossierRequirement[]> | undefined,
  buildingType: string | null,
): JurisdictionDossierRequirement[] {
  if (templates === undefined) return [];
  if (buildingType !== null && templates[buildingType] !== undefined) {
    return templates[buildingType];
  }
  return templates['other'] ?? [];
}

type CompletionPoint = { t: number; pct: number };

/**
 * Replays ready attachments and certificates oldest-first, tracking when each
 * trackable requirement first became fulfilled. Covers attachment-slot and
 * certificate-type requirements — derived requirements (models, findings,
 * deadlines) are point-in-time and have no historical progression.
 */
export function buildCompletionSeries(
  template: JurisdictionDossierRequirement[],
  attachments: Attachment[],
  certificates: Certificate[] = [],
): CompletionPoint[] {
  const slotReqs = template.filter((r) => r.source_kind === 'attachment_slot');
  const certReqs = template.filter((r) => r.source_kind === 'certificate_type');
  const requiredSlots = new Set(slotReqs.map((r) => r.source_value));
  const requiredCertTypes = new Set(certReqs.map((r) => r.source_value));
  const total = requiredSlots.size + requiredCertTypes.size;
  if (total === 0) return [];

  type TimeEntry = { t: number; kind: 'slot' | 'cert'; value: string };
  const entries: TimeEntry[] = [];

  for (const a of attachments) {
    if (a.status === 'ready' && a.dossier_slot !== null && requiredSlots.has(a.dossier_slot)) {
      entries.push({ t: new Date(a.created_at).getTime(), kind: 'slot', value: a.dossier_slot });
    }
  }
  for (const c of certificates) {
    if (c.status === 'ready' && requiredCertTypes.has(c.certificate_type)) {
      entries.push({ t: new Date(c.created_at).getTime(), kind: 'cert', value: c.certificate_type });
    }
  }

  entries.sort((a, b) => a.t - b.t);

  const fulfilledSlots = new Set<string>();
  const fulfilledCerts = new Set<string>();
  const points: CompletionPoint[] = [];

  for (const entry of entries) {
    const before = fulfilledSlots.size + fulfilledCerts.size;
    if (entry.kind === 'slot') {
      fulfilledSlots.add(entry.value);
    } else {
      fulfilledCerts.add(entry.value);
    }
    const after = fulfilledSlots.size + fulfilledCerts.size;
    if (after !== before) {
      points.push({
        t: entry.t,
        pct: Math.round((after / total) * 100),
      });
    }
  }
  return points;
}
