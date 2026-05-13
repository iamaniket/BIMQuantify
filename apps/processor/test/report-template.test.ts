/**
 * Template renderer unit test. No Chromium / Puppeteer involved — just
 * asserts the HTML the renderer produces from a known compliance JSON.
 */

import { describe, expect, it } from 'vitest';

import {
  escapeHtml,
  renderHtml,
  type ComplianceReportData,
} from '../src/pipeline/report/templates/compliance-report.js';

const SAMPLE: ComplianceReportData = {
  report_id: '11111111-1111-1111-1111-111111111111',
  generated_at: '2026-05-12T09:30:00Z',
  locale: 'nl',
  project: {
    id: 'p1',
    name: 'Woonhuis Smit',
    reference_code: 'PR-001',
    address: {
      street: 'Hoofdstraat',
      house_number: '12A',
      postal_code: '1011 AB',
      city: 'Amsterdam',
      municipality: 'Amsterdam',
    },
    permit_number: 'OMG-2026-0042',
    delivery_date: '2026-09-30',
    contractor: {
      name: 'Bouwbedrijf De Vries',
      kvk_number: '12345678',
    },
  },
  compliance: {
    framework: 'bbl',
    checked_at: '2026-05-12T09:00:00Z',
    total_rules: 4,
    total_elements_checked: 27,
    rules_summary: [
      {
        rule_id: 'R-1',
        article: 'BBL-2.107',
        title: 'Fire compartmentation',
        title_nl: 'Brandcompartimentering',
        category: 'fire_safety',
        severity: 'high',
        pass_count: 3,
        fail_count: 1,
        warn_count: 0,
        skip_count: 0,
      },
      {
        rule_id: 'R-2',
        article: 'BBL-3.4',
        title: 'Stair safety',
        title_nl: 'Trapveiligheid',
        category: 'safety',
        severity: 'medium',
        pass_count: 8,
        fail_count: 0,
        warn_count: 2,
        skip_count: 0,
      },
    ],
    category_summary: [
      {
        category: 'fire_safety',
        total_rules: 1,
        total_checks: 4,
        passed: 3,
        failed: 1,
        warned: 0,
      },
      {
        category: 'safety',
        total_rules: 1,
        total_checks: 10,
        passed: 8,
        failed: 0,
        warned: 2,
      },
    ],
  },
};

describe('renderHtml', () => {
  it('produces a complete HTML document with project header data', () => {
    const html = renderHtml(SAMPLE);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Nalevingsrapport');
    expect(html).toContain('Woonhuis Smit');
    expect(html).toContain('PR-001');
    // Address line composes street + house_number + postal_code + city + municipality.
    expect(html).toContain('Hoofdstraat 12A');
    expect(html).toContain('1011 AB Amsterdam');
    expect(html).toContain('Bouwbedrijf De Vries');
    expect(html).toContain('OMG-2026-0042');
  });

  it('uses Dutch rule titles when title_nl is present', () => {
    const html = renderHtml(SAMPLE);
    expect(html).toContain('Brandcompartimentering');
    expect(html).toContain('Trapveiligheid');
    // Should NOT use the English fallback when Dutch is present.
    expect(html).not.toContain('Fire compartmentation');
  });

  it('falls back to title when title_nl is missing', () => {
    const data: ComplianceReportData = {
      ...SAMPLE,
      compliance: {
        ...SAMPLE.compliance,
        rules_summary: [
          {
            rule_id: 'R-3',
            title: 'Untranslated',
            title_nl: null,
            pass_count: 1,
            fail_count: 0,
            warn_count: 0,
          },
        ],
      },
    };
    const html = renderHtml(data);
    expect(html).toContain('Untranslated');
  });

  it('renders an overall score derived from category totals', () => {
    const html = renderHtml(SAMPLE);
    // 11 passed / (11 + 1 fail + 2 warn) = 11/14 ≈ 79%
    expect(html).toContain('79');
    expect(html).toContain('Naleving');
  });

  it('shows an empty-state message when there are no rules', () => {
    const html = renderHtml({
      ...SAMPLE,
      compliance: { framework: 'bbl', total_rules: 0 },
    });
    expect(html).toContain('Geen controleresultaten beschikbaar');
  });

  it('escapes HTML in user-controlled fields', () => {
    const html = renderHtml({
      ...SAMPLE,
      project: { ...SAMPLE.project, name: '<script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('formats the generated_at in Dutch DD-MM-YYYY style', () => {
    const html = renderHtml(SAMPLE);
    expect(html).toContain('12-05-2026');
  });

  it('uppercases the framework label', () => {
    const html = renderHtml(SAMPLE);
    expect(html).toContain('BBL');
  });
});

describe('escapeHtml', () => {
  it('handles all five XML entities', () => {
    expect(escapeHtml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });

  it('passes through plain text unchanged', () => {
    expect(escapeHtml('Brandcompartimentering — geen wijzigingen')).toBe(
      'Brandcompartimentering — geen wijzigingen',
    );
  });
});
