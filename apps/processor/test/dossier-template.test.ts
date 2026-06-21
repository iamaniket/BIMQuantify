import { describe, expect, it } from 'vitest';

import {
  renderHtml,
  type DossierData,
} from '../src/pipeline/report/templates/dossier.js';

function makeData(): DossierData {
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
      address: { street: 'Hoofdstraat', house_number: '12', postal_code: '1011 AB', city: 'Amsterdam' },
      contractor: { name: 'Bouwbedrijf X', kvk_number: '99887766' },
    },
    assurance_plan: {
      version_number: 1,
      status: 'published',
      created_by: 'Marie KB',
      moments: [
        {
          phase: 'foundation',
          name: 'Funderingsinspectie',
          planned_date: '2026-06-01',
          actual_date: null,
          responsible: null,
          status: 'planned',
          checklist_items: [],
        },
      ],
    },
    risks: [
      {
        category: 'fire_safety',
        level: 'high',
        description: 'Compartimentering',
        mitigation: 'Brandwerende doorvoeringen',
        responsible_party: 'Aannemer',
        bbl_article_ref: 'BBL-2.10',
      },
    ],
    findings: [
      {
        title: 'Scheur in fundering',
        description: 'Haarscheur geconstateerd',
        severity: 'high',
        status: 'resolved',
        deadline_date: '2026-06-15',
        bbl_article_ref: 'BBL-4.1',
        resolution_note: 'Geïnjecteerd en gecontroleerd',
        photos: [
          { storage_key: 'k1', content_type: 'image/jpeg', data_url: 'data:image/jpeg;base64,AAAA' },
        ],
      },
    ],
    certificates: [
      {
        certificate_type: 'product',
        certificate_number: 'DoP-1',
        issuer: 'Kiwa',
        subject: 'Beton',
        valid_from: '2025-01-01',
        valid_until: '2027-01-01',
        filename: 'dop.pdf',
        content_type: 'application/pdf',
        storage_key: 'certs/dop.pdf',
      },
    ],
    verklaring: {
      storage_key: 'reports/v.pdf',
      content_type: 'application/pdf',
      signature_hash: 'a'.repeat(64),
    },
  };
}

describe('dossier template', () => {
  it('renders all sections with the dossier title', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('Dossier bevoegd gezag');
    expect(html).toContain('Risicobeoordeling');
    expect(html).toContain('Borgingsplan');
    expect(html).toContain('Bevindingen');
    expect(html).toContain('Certificaten');
    expect(html).toContain('Inhoudsopgave');
  });

  it('renders findings with NL severity/status labels + resolution', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('Scheur in fundering');
    expect(html).toContain('Hoog'); // high severity
    expect(html).toContain('Opgelost'); // resolved status
    expect(html).toContain('Geïnjecteerd en gecontroleerd'); // resolution note
  });

  it('embeds finding photos that have a data_url', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('data:image/jpeg;base64,AAAA');
  });

  it('lists certificates + notes that PDFs are attached', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('Productcertificaat');
    expect(html).toContain('Kiwa');
    expect(html).toContain('als bijlage'); // certificatesAttachedNote
  });

  it('notes the attached signed verklaring + its audit hash', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('ondertekende verklaring');
    expect(html).toContain('a'.repeat(64));
  });

  it('shows empty-states + missing-declaration note when data is sparse', () => {
    const data = makeData();
    data.findings = [];
    data.certificates = [];
    data.verklaring = null;
    const html = renderHtml(data);
    expect(html).toContain('Geen bevindingen vastgelegd.');
    expect(html).toContain('Geen certificaten vastgelegd.');
    expect(html).toContain('Nog geen ondertekende verklaring');
  });

  it('escapes HTML in user-controlled fields', () => {
    const data = makeData();
    data.findings[0]!.title = '<script>alert(1)</script>';
    const html = renderHtml(data);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
