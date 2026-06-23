import { describe, expect, it } from 'vitest';

import {
  renderHtml,
  type SnagListData,
} from '../src/pipeline/report/templates/snag-list.js';

function makeData(): SnagListData {
  return {
    report_id: '22222222-2222-2222-2222-222222222222',
    generated_at: '2026-05-31T10:00:00Z',
    locale: 'nl',
    jurisdiction: 'NL',
    project: {
      id: 'p1',
      name: 'Test Project',
      country: 'NL',
      reference_code: 'REF-1',
      address: { street: 'Hoofdstraat', house_number: '12', postal_code: '1011 AB', city: 'Amsterdam' },
    },
    recipient: { name: 'Loodgieter BV', email: 'info@loodgieter.nl' },
    filters: { status: null, severity: 'high' },
    findings: [
      {
        title: 'Lekkage bij standleiding',
        description: 'Vochtplek onder de standleiding',
        severity: 'high',
        status: 'open',
        assignee: 'Loodgieter BV',
        deadline_date: '2026-06-15',
        bbl_article_ref: 'BBL-4.1',
        resolution_note: null,
        created_at: '2026-05-20T08:00:00Z',
        linked_element_global_id: '3kF4p5c6m7N8o9P0q1rS2t',
        linked_file_type: 'ifc',
        anchor_x: 1.5,
        anchor_y: 2.5,
        anchor_z: 0.5,
        photos: [
          { storage_key: 'k1', content_type: 'image/jpeg', captured_at: '2026-05-20T08:01:00Z', data_url: 'data:image/jpeg;base64,AAAA' },
        ],
      },
      {
        title: 'Afvoer niet aangesloten',
        description: 'Wastafel-afvoer los',
        severity: 'medium',
        status: 'resolved',
        assignee: 'Loodgieter BV',
        deadline_date: null,
        bbl_article_ref: null,
        resolution_note: 'Aangesloten en getest',
        created_at: '2026-05-21T08:00:00Z',
        photos: [],
      },
    ],
  };
}

describe('snag-list template', () => {
  it('renders the snag-list title + project + recipient on the cover', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('Bevindingenlijst');
    expect(html).toContain('Test Project');
    expect(html).toContain('Loodgieter BV');
    expect(html).toContain('info@loodgieter.nl');
    expect(html).toContain('Ontvanger');
  });

  it('groups findings by status with counts (NL labels)', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('Open (1)'); // open group heading
    expect(html).toContain('Opgelost (1)'); // resolved group heading
    expect(html).toContain('Lekkage bij standleiding');
    expect(html).toContain('Hoog'); // high severity label
  });

  it('embeds finding photos with their capture timestamp', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('data:image/jpeg;base64,AAAA');
    expect(html).toContain('Vastgelegd'); // capturedAt caption label
  });

  it('renders the resolution note when present', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('Aangesloten en getest');
  });

  it('renders EN labels when locale is en', () => {
    const data = makeData();
    data.locale = 'en';
    const html = renderHtml(data);
    expect(html).toContain('Snag list');
    expect(html).toContain('Recipient');
    expect(html).toContain('Open (1)');
    expect(html).toContain('Resolved (1)');
  });

  it('shows the no-findings empty state', () => {
    const data = makeData();
    data.findings = [];
    const html = renderHtml(data);
    expect(html).toContain('Geen bevindingen gevonden');
  });

  it('escapes HTML in user-controlled fields', () => {
    const data = makeData();
    data.findings[0]!.title = '<script>alert(1)</script>';
    const html = renderHtml(data);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
