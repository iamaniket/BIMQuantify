import { describe, expect, it } from 'vitest';

import type { FindingTemplate } from '@/lib/api/schemas';

import {
  buildFindingCreatePayload,
  type FindingCreateExtra,
  type FindingCreateFormValues,
} from './findingCreatePayload';

const VALUES: FindingCreateFormValues = {
  title: '  Brandwerende doorvoer  ',
  description: '  Niet afgewerkt  ',
  severity: 'high',
  bbl_article_ref: '',
};

const EMPTY_EXTRA: FindingCreateExtra = {
  photoIds: [],
  referenceAttachmentIds: [],
  customValues: {},
  template: null,
};

function template(overrides: Partial<FindingTemplate>): FindingTemplate {
  return {
    id: 't1',
    template_type: 'standard',
    name: 'T',
    description: null,
    is_default: false,
    builtin_fields: {},
    fields: [],
    created_by_user_id: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as FindingTemplate;
}

describe('buildFindingCreatePayload', () => {
  it('trims text and nulls empty link/bbl fields for the standard form', () => {
    const result = buildFindingCreatePayload(VALUES, EMPTY_EXTRA, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.title).toBe('Brandwerende doorvoer');
    expect(result.payload.description).toBe('Niet afgewerkt');
    expect(result.payload.severity).toBe('high');
    expect(result.payload.bbl_article_ref).toBeNull();
    expect(result.payload.linked_model_id).toBeNull();
    expect(result.payload.linked_file_id).toBeNull();
    expect(result.payload.linked_element_global_id).toBeNull();
    expect(result.payload.photo_ids).toBeUndefined();
    expect(result.payload.reference_attachment_ids).toBeUndefined();
    expect(result.payload.template_id).toBeNull();
    expect(result.payload.custom_values).toBeUndefined();
  });

  it('threads element link + 3D anchor coordinates', () => {
    const result = buildFindingCreatePayload(VALUES, EMPTY_EXTRA, {
      linkedModelId: 'm1',
      linkedFileId: 'f1',
      linkedElementGlobalId: 'GID123',
      linkedFileType: 'ifc',
      linkedPoint: { x: 1, y: 2, z: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.linked_model_id).toBe('m1');
    expect(result.payload.linked_file_id).toBe('f1');
    expect(result.payload.linked_element_global_id).toBe('GID123');
    expect(result.payload.linked_file_type).toBe('ifc');
    expect(result.payload.anchor_x).toBe(1);
    expect(result.payload.anchor_y).toBe(2);
    expect(result.payload.anchor_z).toBe(3);
    expect(result.payload.anchor_page).toBeUndefined();
  });

  it('threads a 2D PDF anchor (page + normalized x/y, no z)', () => {
    const result = buildFindingCreatePayload(VALUES, EMPTY_EXTRA, {
      linkedFileType: 'pdf',
      linkedPoint: { x: 0.4, y: 0.6, page: 2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.linked_file_type).toBe('pdf');
    expect(result.payload.anchor_page).toBe(2);
    expect(result.payload.anchor_x).toBe(0.4);
    expect(result.payload.anchor_y).toBe(0.6);
    expect(result.payload.anchor_z).toBeUndefined();
  });

  it('passes photo + reference ids through and records the template id', () => {
    const tpl = template({ id: 'tpl-9' });
    const result = buildFindingCreatePayload(
      VALUES,
      { photoIds: ['p1', 'p2'], referenceAttachmentIds: ['r1'], customValues: {}, template: tpl },
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.photo_ids).toEqual(['p1', 'p2']);
    expect(result.payload.reference_attachment_ids).toEqual(['r1']);
    expect(result.payload.template_id).toBe('tpl-9');
  });

  it('rejects when a required built-in field is blank', () => {
    const tpl = template({
      builtin_fields: { bbl_article_ref: { visible: true, required: true } },
    });
    const result = buildFindingCreatePayload(
      { ...VALUES, bbl_article_ref: '' },
      { ...EMPTY_EXTRA, template: tpl },
      {},
    );
    expect(result.ok).toBe(false);
  });

  it('rejects when required photos / references are missing', () => {
    const tpl = template({
      builtin_fields: {
        photos: { visible: true, required: true },
        references: { visible: true, required: true },
      },
    });
    expect(
      buildFindingCreatePayload(VALUES, { ...EMPTY_EXTRA, template: tpl }, {}).ok,
    ).toBe(false);
    expect(
      buildFindingCreatePayload(
        VALUES,
        { ...EMPTY_EXTRA, template: tpl, photoIds: ['p1'], referenceAttachmentIds: ['r1'] },
        {},
      ).ok,
    ).toBe(true);
  });

  it('validates required custom fields and folds answered ones into the payload', () => {
    const tpl = template({
      fields: [
        { id: 'c1', type: 'text', label: 'Note', required: true },
        { id: 'c2', type: 'checkbox', label: 'Confirm', required: true },
      ] as FindingTemplate['fields'],
    });

    // Missing both required custom fields → rejected.
    expect(
      buildFindingCreatePayload(VALUES, { ...EMPTY_EXTRA, template: tpl }, {}).ok,
    ).toBe(false);

    // Unchecked required checkbox → rejected.
    expect(
      buildFindingCreatePayload(
        VALUES,
        { ...EMPTY_EXTRA, template: tpl, customValues: { c1: 'x' } },
        {},
      ).ok,
    ).toBe(false);

    const ok = buildFindingCreatePayload(
      VALUES,
      { ...EMPTY_EXTRA, template: tpl, customValues: { c1: 'x', c2: true } },
      {},
    );
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.payload.custom_values).toEqual({ c1: 'x', c2: true });
  });
});
