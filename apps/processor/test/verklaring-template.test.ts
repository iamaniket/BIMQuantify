import { describe, expect, it } from 'vitest';

import {
  renderHtml,
  type VerklaringData,
} from '../src/pipeline/report/templates/verklaring.js';

function makeData(signed = false): VerklaringData {
  return {
    report_id: '11111111-1111-1111-1111-111111111111',
    generated_at: '2026-05-31T10:00:00Z',
    locale: 'nl',
    jurisdiction: 'NL',
    project: {
      id: 'p1',
      name: 'Test Project',
      country: 'NL',
      reference_code: 'REF-1',
      address: {
        street: 'Hoofdstraat',
        house_number: '12',
        postal_code: '1011 AB',
        city: 'Amsterdam',
      },
    },
    declaration: {
      kwaliteitsborger: 'Marie Inspecteur',
      kwaliteitsborger_email: 'marie@kb.nl',
      signed,
      signed_at: signed ? '2026-05-31T11:00:00Z' : null,
      signature_hash: signed ? 'a'.repeat(64) : null,
    },
  };
}

describe('verklaring template', () => {
  it('renders the declaration with the KB name', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Verklaring kwaliteitsborger');
    expect(html).toContain('Marie Inspecteur');
    expect(html).toContain('Bbl'); // declaration body references the Bbl
  });

  it('shows the draft notice + unsigned placeholder when not signed', () => {
    const html = renderHtml(makeData(false));
    expect(html).toContain('Concept');
    expect(html).toContain('Nog niet ondertekend');
    expect(html).not.toContain('a'.repeat(64));
  });

  it('shows the signed stamp + audit hash when signed', () => {
    const html = renderHtml(makeData(true));
    expect(html).toContain('Ondertekend');
    expect(html).toContain('a'.repeat(64)); // audit-id hash
    expect(html).not.toContain('Nog niet ondertekend');
  });

  it('escapes HTML in the kwaliteitsborger name', () => {
    const data = makeData();
    data.declaration.kwaliteitsborger = '<b>x</b>';
    const html = renderHtml(data);
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});
