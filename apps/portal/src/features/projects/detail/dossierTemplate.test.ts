import { describe, expect, it } from 'vitest';

import type { JurisdictionDossierRequirement } from '@/lib/api/jurisdictions';
import type { Attachment, Certificate } from '@/lib/api/schemas';

import {
  buildCompletionSeries,
  computeDossierCompleteness,
  selectDossierTemplate,
} from './dossierTemplate';

function req(
  overrides: Partial<JurisdictionDossierRequirement> &
    Pick<JurisdictionDossierRequirement, 'code' | 'source_kind' | 'source_value'>,
): JurisdictionDossierRequirement {
  return {
    category: 'documents',
    label: overrides.code,
    required: true,
    ...overrides,
  };
}

function att(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: crypto.randomUUID(),
    project_id: '00000000-0000-0000-0000-000000000000',
    uploaded_by_user_id: null,
    uploaded_by_name: null,
    capture_link_id: null,
    original_filename: 'doc.pdf',
    size_bytes: 1,
    content_type: 'application/pdf',
    content_sha256: null,
    role: 'attachment',
    attachment_category: 'office',
    status: 'ready',
    rejection_reason: null,
    description: null,
    dossier_slot: null,
    capture_metadata: null,
    server_metadata: null,
    version_number: 1,
    parent_file_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function cert(overrides: Partial<Certificate> = {}): Certificate {
  return {
    id: crypto.randomUUID(),
    project_id: '00000000-0000-0000-0000-000000000000',
    uploaded_by_user_id: null,
    uploaded_by_name: null,
    original_filename: 'cert.pdf',
    size_bytes: 1,
    content_type: 'application/pdf',
    content_sha256: null,
    certificate_type: 'product',
    status: 'ready',
    rejection_reason: null,
    description: null,
    certificate_number: null,
    issuer: null,
    subject: null,
    valid_from: null,
    valid_until: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Certificate;
}

describe('computeDossierCompleteness', () => {
  it('fulfils an attachment-slot requirement only from a ready, matching-slot doc', () => {
    const template = [req({ code: 'calc', source_kind: 'attachment_slot', source_value: 'structural_calculations' })];

    const empty = computeDossierCompleteness(template, [], []);
    expect(empty.requirements[0]?.fulfilled).toBe(false);
    expect(empty.pct).toBe(0);

    // Wrong slot → still missing.
    const wrongSlot = computeDossierCompleteness(template, [att({ dossier_slot: 'drawings' })], []);
    expect(wrongSlot.requirements[0]?.fulfilled).toBe(false);

    // Pending (not ready) → ignored.
    const pending = computeDossierCompleteness(
      template,
      [att({ dossier_slot: 'structural_calculations', status: 'pending' })],
      [],
    );
    expect(pending.requirements[0]?.fulfilled).toBe(false);

    // Ready + matching → fulfilled, counted.
    const ok = computeDossierCompleteness(
      template,
      [att({ dossier_slot: 'structural_calculations' })],
      [],
    );
    expect(ok.requirements[0]?.fulfilled).toBe(true);
    expect(ok.requirements[0]?.count).toBe(1);
    expect(ok.pct).toBe(100);
  });

  it('fulfils a certificate-type requirement from a ready matching certificate', () => {
    const template = [req({ code: 'prod', category: 'certificates', source_kind: 'certificate_type', source_value: 'product' })];
    const ok = computeDossierCompleteness(template, [], [cert({ certificate_type: 'product' })]);
    expect(ok.requirements[0]?.fulfilled).toBe(true);
    const wrong = computeDossierCompleteness(template, [], [cert({ certificate_type: 'warranty' })]);
    expect(wrong.requirements[0]?.fulfilled).toBe(false);
  });

  it('resolves derived signals (models / findings / deadlines)', () => {
    const template = [
      req({ code: 'm', category: 'quality', source_kind: 'derived', source_value: 'models' }),
      req({ code: 'f', category: 'quality', source_kind: 'derived', source_value: 'findings' }),
      req({ code: 'd', category: 'quality', source_kind: 'derived', source_value: 'deadlines' }),
    ];
    const res = computeDossierCompleteness(template, [], [], {
      modelCount: 2,
      findingsOpen: 1,
      deadlinesOverdue: 0,
    });
    const byCode = Object.fromEntries(res.requirements.map((r) => [r.code, r]));
    expect(byCode['m']?.fulfilled).toBe(true); // models present
    expect(byCode['f']?.fulfilled).toBe(false); // 1 open finding
    expect(byCode['d']?.fulfilled).toBe(true); // none overdue
  });

  it('fulfils a model requirement when modelCount > 0', () => {
    const template = [req({ code: 'model', category: 'models', source_kind: 'model', source_value: 'models' })];

    const empty = computeDossierCompleteness(template, [], [], { modelCount: 0 });
    expect(empty.requirements[0]?.fulfilled).toBe(false);
    expect(empty.pct).toBe(0);

    const present = computeDossierCompleteness(template, [], [], { modelCount: 1 });
    expect(present.requirements[0]?.fulfilled).toBe(true);
    expect(present.requirements[0]?.count).toBe(1);
    expect(present.pct).toBe(100);
  });

  it('fulfils an attachment_or_model requirement from a drawing OR a present model', () => {
    const template = [
      req({ code: 'drawings', source_kind: 'attachment_or_model', source_value: 'drawings' }),
    ];

    // Neither a drawing nor a model → missing.
    const none = computeDossierCompleteness(template, [], [], { modelCount: 0 });
    expect(none.requirements[0]?.fulfilled).toBe(false);
    expect(none.pct).toBe(0);

    // A BIM model present, no drawing attachment → fulfilled via the model.
    const viaModel = computeDossierCompleteness(template, [], [], { modelCount: 1 });
    expect(viaModel.requirements[0]?.fulfilled).toBe(true);
    expect(viaModel.requirements[0]?.count).toBe(1);
    expect(viaModel.pct).toBe(100);

    // A matching drawing attachment, no model → fulfilled via the attachment.
    const viaDrawing = computeDossierCompleteness(
      template,
      [att({ dossier_slot: 'drawings' })],
      [],
      { modelCount: 0 },
    );
    expect(viaDrawing.requirements[0]?.fulfilled).toBe(true);
    expect(viaDrawing.requirements[0]?.count).toBe(1);
  });

  it('drives pct from required items only; optional tracked separately', () => {
    const template = [
      req({ code: 'a', source_kind: 'attachment_slot', source_value: 'drawings', required: true }),
      req({ code: 'b', source_kind: 'attachment_slot', source_value: 'assurance', required: false }),
    ];
    const res = computeDossierCompleteness(template, [att({ dossier_slot: 'drawings' })], []);
    expect(res.total).toBe(1); // only the required item
    expect(res.filled).toBe(1);
    expect(res.pct).toBe(100);
    expect(res.optionalTotal).toBe(1);
    expect(res.optionalFilled).toBe(0);
  });

  it('groups requirements by category preserving order', () => {
    const template = [
      req({ code: 'a', category: 'documents', source_kind: 'attachment_slot', source_value: 'drawings' }),
      req({ code: 'c', category: 'certificates', source_kind: 'certificate_type', source_value: 'product' }),
      req({ code: 'b', category: 'documents', source_kind: 'attachment_slot', source_value: 'fire_safety' }),
    ];
    const res = computeDossierCompleteness(template, [], []);
    expect(res.groups.map((g) => g.category)).toEqual(['documents', 'certificates']);
    expect(res.groups[0]?.total).toBe(2);
  });

  it('returns 100% for an empty template (nothing required)', () => {
    expect(computeDossierCompleteness([], [], []).pct).toBe(100);
  });
});

describe('selectDossierTemplate', () => {
  const templates = {
    dwelling: [req({ code: 'dw', source_kind: 'derived', source_value: 'models' })],
    other: [req({ code: 'ot', source_kind: 'derived', source_value: 'findings' })],
  };

  it('picks the building-type set when present', () => {
    expect(selectDossierTemplate(templates, 'dwelling')[0]?.code).toBe('dw');
  });
  it('falls back to "other" for null/unknown building type', () => {
    expect(selectDossierTemplate(templates, null)[0]?.code).toBe('ot');
    expect(selectDossierTemplate(templates, 'warehouse')[0]?.code).toBe('ot');
  });
  it('returns [] when templates are undefined', () => {
    expect(selectDossierTemplate(undefined, 'dwelling')).toEqual([]);
  });
});

describe('buildCompletionSeries', () => {
  it('emits a rising point each time a new distinct slot or cert type is first filled', () => {
    const template = [
      req({ code: 'a', source_kind: 'attachment_slot', source_value: 'drawings' }),
      req({ code: 'b', source_kind: 'attachment_slot', source_value: 'fire_safety' }),
      req({ code: 'c', source_kind: 'certificate_type', source_value: 'product' }),
    ];
    const series = buildCompletionSeries(
      template,
      [
        att({ dossier_slot: 'drawings', created_at: '2026-01-01T00:00:00Z' }),
        att({ dossier_slot: 'drawings', created_at: '2026-01-02T00:00:00Z' }), // dup slot → no new point
        att({ dossier_slot: 'fire_safety', created_at: '2026-01-03T00:00:00Z' }),
      ],
      [
        cert({ certificate_type: 'product', created_at: '2026-01-04T00:00:00Z' }),
      ],
    );
    // 3 trackable requirements (2 slots + 1 cert type) → 33%, 67%, 100%.
    expect(series.map((p) => p.pct)).toEqual([33, 67, 100]);
  });

  it('tracks an attachment_or_model slot in the completion series', () => {
    const template = [
      req({ code: 'drawings', source_kind: 'attachment_or_model', source_value: 'drawings' }),
    ];
    const series = buildCompletionSeries(template, [att({ dossier_slot: 'drawings' })]);
    expect(series.map((p) => p.pct)).toEqual([100]);
  });

  it('returns [] when the template has no trackable requirements', () => {
    const template = [req({ code: 'd', source_kind: 'derived', source_value: 'models' })];
    expect(buildCompletionSeries(template, [att({ dossier_slot: 'drawings' })])).toEqual([]);
  });
});
