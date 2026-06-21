import { describe, expect, it } from 'vitest';

import {
  buildMergeContext,
  interpolate,
  renderSections,
  toLayoutBranding,
  type ContentSectionRender,
} from '../src/pipeline/report/templates/_helpers.js';
import { layout } from '../src/pipeline/report/templates/_layout.js';
import { renderHtml, type DossierData } from '../src/pipeline/report/templates/dossier.js';

describe('interpolate', () => {
  it('resolves dotted paths', () => {
    expect(interpolate('Hi {{project.name}}', { project: { name: 'Acme' } })).toBe('Hi Acme');
  });
  it('unknown paths resolve to empty string', () => {
    expect(interpolate('x{{missing.deep.path}}y', {})).toBe('xy');
  });
  it('HTML-escapes values (no injection)', () => {
    expect(interpolate('{{v}}', { v: '<script>' })).toBe('&lt;script&gt;');
  });
  it('does not execute anything for non-path braces', () => {
    expect(interpolate('literal {not a path}', {})).toBe('literal {not a path}');
  });
});

describe('buildMergeContext', () => {
  it('exposes project, contractor and report.generated_at', () => {
    const ctx = buildMergeContext({
      project: { id: 'p', name: 'P', contractor: { name: 'C', kvk_number: '123' } },
      generated_at: '2026-05-31T10:00:00Z',
    });
    expect(interpolate('{{project.name}}', ctx)).toBe('P');
    expect(interpolate('{{contractor.kvk_number}}', ctx)).toBe('123');
    expect(interpolate('{{report.generated_at}}', ctx)).toContain('31-05-2026');
  });
});

describe('renderSections', () => {
  const content: ContentSectionRender[] = [
    { key: 'a', defaultTitle: 'Section A', html: '<p>A-body</p>' },
    { key: 'b', defaultTitle: 'Section B', html: '<p>B-body</p>' },
  ];

  it('with no config renders every content section in canonical order', () => {
    const out = renderSections(content, undefined, {});
    expect(out).toContain('Section A');
    expect(out).toContain('Section B');
    expect(out.indexOf('Section A')).toBeLessThan(out.indexOf('Section B'));
  });

  it('reorders, applies title_override, drops disabled, and interpolates text blocks', () => {
    const out = renderSections(
      content,
      [
        { type: 'content', key: 'b', enabled: true, title_override: 'Custom B' },
        { type: 'text', id: 't1', title: 'Intro', body: 'Voor {{project.name}}' },
        { type: 'content', key: 'a', enabled: false },
      ],
      { project: { name: 'Acme' } },
    );
    expect(out).toContain('Custom B');
    expect(out).toContain('B-body');
    expect(out).toContain('Voor Acme');
    expect(out).not.toContain('A-body'); // disabled
    expect(out.indexOf('Custom B')).toBeLessThan(out.indexOf('Voor Acme'));
  });

  it('skips unknown content keys gracefully', () => {
    const out = renderSections(content, [{ type: 'content', key: 'nope' }], {});
    expect(out).toBe('');
  });
});

describe('toLayoutBranding', () => {
  it('returns undefined without branding', () => {
    expect(toLayoutBranding(undefined)).toBeUndefined();
    expect(toLayoutBranding(null)).toBeUndefined();
  });
  it('maps snake_case config to camelCase layout branding', () => {
    expect(
      toLayoutBranding({
        logo_data_url: 'd',
        accent_color: '#112233',
        accent_color_secondary: '#445566',
        header_text: 'H',
        footer_text: 'F',
      }),
    ).toEqual({
      logoDataUrl: 'd',
      accentColor: '#112233',
      accentColorSecondary: '#445566',
      headerText: 'H',
      footerText: 'F',
    });
  });
});

describe('layout branding', () => {
  const base = { title: 'T', generatedAt: '31-05-2026', body: '<p>x</p>', locale: 'nl' };

  it('injects accent overrides AFTER the base stylesheet so they win', () => {
    const out = layout({
      ...base,
      branding: { accentColor: '#ff0000', accentColorSecondary: '#00ff00' },
    });
    expect(out).toContain('--c-primary:#ff0000');
    expect(out).toContain('--c-secondary:#00ff00');
    // The override appears after the base token (which sets --c-primary: #1d4ed8).
    expect(out.indexOf('--c-primary:#ff0000')).toBeGreaterThan(out.indexOf('--c-primary: #1d4ed8'));
  });

  it('rejects non-hex accent colours (defence in depth)', () => {
    const out = layout({ ...base, branding: { accentColor: 'red; }*/evil' } });
    expect(out).not.toContain('evil');
    expect(out).not.toContain('--c-primary:red');
  });

  it('renders the logo band + header text and replaces the footer label', () => {
    const out = layout({
      ...base,
      branding: {
        logoDataUrl: 'data:image/png;base64,AAA',
        headerText: 'ACME BV',
        footerText: 'ACME Reports',
      },
    });
    expect(out).toContain('class="brand-logo" src="data:image/png;base64,AAA"');
    expect(out).toContain('ACME BV');
    expect(out).toContain('ACME Reports · 31-05-2026');
    expect(out).not.toContain('BimDossier ·');
  });

  it('renders bare (no brand band, default footer) without branding', () => {
    const out = layout(base);
    expect(out).not.toContain('class="brand-band"');
    expect(out).toContain('BimDossier · 31-05-2026');
  });
});

// --- dossier renderHtml with a template -------------------------------------

function dossierData(): DossierData {
  return {
    report_id: '11111111-1111-1111-1111-111111111111',
    generated_at: '2026-05-31T10:00:00Z',
    locale: 'nl',
    jurisdiction: 'NL',
    project: { id: 'p1', name: 'Test Project', country: 'NL', reference_code: 'REF-1' },
    assurance_plan: null,
    risks: [],
    findings: [
      {
        title: 'Scheur in fundering',
        description: 'Haarscheur',
        severity: 'high',
        status: 'open',
        photos: [],
      },
    ],
    certificates: [
      {
        certificate_type: 'product',
        issuer: 'Kiwa',
        filename: 'dop.pdf',
        content_type: 'application/pdf',
        storage_key: 'k',
      },
    ],
    verklaring: null,
  };
}

describe('dossier renderHtml with template', () => {
  it('applies branding, section toggles/reorder, and interpolated text blocks', () => {
    const data = dossierData();
    data.template = {
      branding: { accent_color: '#123456', header_text: 'ACME' },
      sections: [
        { type: 'content', key: 'findings', enabled: true },
        { type: 'text', id: 't_x', title: 'Toelichting', body: 'Voor {{project.name}}' },
        { type: 'content', key: 'certificates', enabled: false },
      ],
    };
    const html = renderHtml(data);
    expect(html).toContain('--c-primary:#123456');
    expect(html).toContain('ACME');
    expect(html).toContain('Voor Test Project'); // interpolated text block
    expect(html).toContain('Scheur in fundering'); // findings section kept
    expect(html).not.toContain('Kiwa'); // certificates section disabled (table absent)
  });

  it('renders per-finding GUID + location (snap identity)', () => {
    const data = dossierData();
    const f = data.findings[0]!;
    f.linked_element_global_id = '2O2Fr4X7Zf8NOew3FNr2';
    f.linked_file_type = 'ifc';
    f.anchor_x = 1.5;
    f.anchor_y = 2.5;
    f.anchor_z = 3.5;
    const html = renderHtml(data);
    expect(html).toContain('Element-ID');
    expect(html).toContain('2O2Fr4X7Zf8NOew3FNr2');
    expect(html).toContain('Locatie');
    expect(html).toContain('1.50, 2.50, 3.50');
  });

  it('matches pre-template output when no template is set', () => {
    const html = renderHtml(dossierData());
    expect(html).toContain('Bevindingen');
    expect(html).toContain('Certificaten');
    expect(html).not.toContain('class="brand-band"');
    expect(html).toContain('BimDossier ·');
  });
});
