import { describe, expect, it } from 'vitest';

import type { AlignedSheet } from '@/lib/api/schemas';

import {
  buildSourceLevels,
  groupSheetsByLevel,
  resolveActiveSheet,
  sourceActiveLevelIndex,
  type StoreyLite,
} from './drawingSources';

/** Minimal calibrated AlignedSheet for the resolution logic under test. */
function sheet(p: Partial<AlignedSheet>): AlignedSheet {
  return {
    id: p.id ?? 'sh',
    level_id: p.level_id ?? 'L1',
    pdf_document_id: p.pdf_document_id ?? 'pdf',
    page_index: p.page_index ?? 0,
    is_calibrated: p.is_calibrated ?? true,
    calibrated_pdf_file_id: p.calibrated_pdf_file_id ?? 'f1',
    ...p,
  } as AlignedSheet;
}

describe('groupSheetsByLevel', () => {
  const disc = new Map<string, string>([
    ['arch', 'architectural'],
    ['struct', 'structural'],
    ['mep', 'mep'],
  ]);

  it('groups by project level and keeps only calibrated sheets', () => {
    const sheets = [
      sheet({ id: 'a', level_id: 'L1', pdf_document_id: 'arch' }),
      sheet({ id: 's', level_id: 'L1', pdf_document_id: 'struct' }),
      sheet({ id: 'b', level_id: 'L2', pdf_document_id: 'arch' }),
      sheet({ id: 'x', level_id: 'L1', pdf_document_id: 'mep', is_calibrated: false }),
      sheet({ id: 'y', level_id: 'L1', pdf_document_id: 'mep', calibrated_pdf_file_id: null }),
    ];
    const m = groupSheetsByLevel(sheets, disc);
    expect(m.get('L1')!.map((s) => s.id)).toEqual(['a', 's']); // x,y dropped
    expect(m.get('L2')!.map((s) => s.id)).toEqual(['b']);
  });

  it('orders architectural first, then by page', () => {
    const sheets = [
      sheet({ id: 'struct', level_id: 'L1', pdf_document_id: 'struct', page_index: 0 }),
      sheet({ id: 'arch-p2', level_id: 'L1', pdf_document_id: 'arch', page_index: 2 }),
      sheet({ id: 'arch-p1', level_id: 'L1', pdf_document_id: 'arch', page_index: 1 }),
    ];
    expect(groupSheetsByLevel(sheets, disc).get('L1')!.map((s) => s.id)).toEqual([
      'arch-p1',
      'arch-p2',
      'struct',
    ]);
  });
});

describe('resolveActiveSheet', () => {
  const disc = new Map([['arch', 'architectural'], ['struct', 'structural']]);
  const here = [
    sheet({ id: 'a', pdf_document_id: 'arch' }),
    sheet({ id: 's', pdf_document_id: 'struct' }),
  ];

  it('returns null for the generated source', () => {
    expect(resolveActiveSheet(here, 'generated', disc)).toBeNull();
  });
  it('returns the sheet matching the preferred discipline', () => {
    expect(resolveActiveSheet(here, 'structural', disc)?.id).toBe('s');
  });
  it('falls back to null when the preferred discipline is absent on this level', () => {
    expect(resolveActiveSheet(here, 'mep', disc)).toBeNull();
  });
  it('returns null when there are no sheets', () => {
    expect(resolveActiveSheet([], 'architectural', disc)).toBeNull();
  });
});

describe('buildSourceLevels', () => {
  const fb = (n: number): string => `Level ${n}`;
  const storeys: StoreyLite[] = [
    { express_id: 10, level_id: 'L1', elevation_m: 0, name: 'Ground' },
    { express_id: 20, level_id: 'L2', elevation_m: 3, name: null },
    { express_id: null, level_id: 'L3', elevation_m: 6, name: 'Roof' }, // dropped (no express)
  ];

  it('sorts top->bottom by elevation, maps express ids, names with fallback', () => {
    const out = buildSourceLevels(storeys, fb);
    expect(out.map((l) => l.storeyExpressID)).toEqual([20, 10]); // 3m above 0m
    expect(out[0]!.name).toBe('Level 1'); // null name -> fallback
    expect(out[1]!.name).toBe('Ground');
  });
});

describe('sourceActiveLevelIndex', () => {
  const fb = (n: number): string => `Level ${n}`;
  const storeys: StoreyLite[] = [
    { express_id: 10, level_id: 'L1', elevation_m: 0, name: 'Ground' },
    { express_id: 20, level_id: 'L2', elevation_m: 3, name: 'First' },
  ];
  const levels = buildSourceLevels(storeys, fb); // [express20 @idx0, express10 @idx1]

  it('finds the source storey index for the active project level', () => {
    expect(sourceActiveLevelIndex(levels, storeys, 'L1')).toBe(1);
    expect(sourceActiveLevelIndex(levels, storeys, 'L2')).toBe(0);
  });
  it('falls back to 0 when the source model has no storey on that level', () => {
    expect(sourceActiveLevelIndex(levels, storeys, 'L9')).toBe(0);
    expect(sourceActiveLevelIndex(levels, storeys, undefined)).toBe(0);
  });
});
