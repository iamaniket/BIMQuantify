import { describe, expect, it } from 'vitest';

import {
  renderHtml,
  type AssurancePlanData,
} from '../src/pipeline/report/templates/assurance-plan.js';

function makeData(): AssurancePlanData {
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
    assurance_plan: {
      version_number: 2,
      status: 'published',
      created_by: 'Jan de Boer',
      published_at: '2026-05-20T09:00:00Z',
      notes: null,
      moments: [
        {
          phase: 'foundation',
          name: 'Funderingsinspectie',
          planned_date: '2026-06-01',
          actual_date: null,
          responsible: 'Marie KB',
          status: 'planned',
          checklist_items: [
            {
              description: 'Wapening conform tekening',
              evidence_type: 'photo',
              bbl_article_ref: 'BBL-4.12',
              pass_fail_criteria: 'Visuele controle',
            },
          ],
        },
      ],
    },
    risks: [
      {
        category: 'fire_safety',
        level: 'high',
        description: 'Compartimentering tussen woningen',
        mitigation: 'Brandwerende doorvoeringen',
        responsible_party: 'Aannemer',
        bbl_article_ref: 'BBL-2.10',
      },
    ],
  };
}

describe('assurance-plan template', () => {
  it('renders a complete HTML document with the borgingsplan title + project', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Borgingsplan');
    expect(html).toContain('Test Project');
  });

  it('maps neutral codes to NL labels', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('Fundering'); // foundation phase
    expect(html).toContain('Brandveiligheid'); // fire_safety category
    expect(html).toContain('Hoog'); // high level
    expect(html).toContain('Foto'); // photo evidence type
  });

  it('renders the kwaliteitsborger on the cover', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('Jan de Boer');
  });

  it('includes a signature block', () => {
    const html = renderHtml(makeData());
    expect(html).toContain('Ondertekening');
  });

  it('shows empty-states when there are no risks or moments', () => {
    const data = makeData();
    data.risks = [];
    data.assurance_plan.moments = [];
    const html = renderHtml(data);
    expect(html).toContain("Geen risico's vastgelegd.");
    expect(html).toContain('Geen borgingsmomenten vastgelegd.');
  });

  it('escapes HTML in user-controlled fields', () => {
    const data = makeData();
    data.project.name = 'A & B <script>alert(1)</script>';
    const html = renderHtml(data);
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
