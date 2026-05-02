import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

import type { CheckResultItem, RuleSummaryItem } from '@/lib/api/schemas';

vi.mock('@bimstitch/ui', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { RulesBreakdown } from './RulesBreakdown';

const rules: RuleSummaryItem[] = [
  {
    rule_id: 'R-001',
    article: 'Bbl 4.30',
    titles: { en: 'Fire compartment separation', nl: 'Brandcompartimentscheiding' },
    category: 'fire_safety',
    severity: 'critical',
    total_checked: 50,
    passed: 40,
    failed: 5,
    warned: 3,
    skipped: 2,
    errors: 0,
  },
  {
    rule_id: 'R-002',
    article: 'Bbl 4.21',
    titles: { en: 'Accessibility sector', nl: 'Toegankelijkheidssector' },
    category: 'accessibility',
    severity: 'major',
    total_checked: 30,
    passed: 28,
    failed: 0,
    warned: 2,
    skipped: 0,
    errors: 0,
  },
];

const details: CheckResultItem[] = [
  {
    rule_id: 'R-001',
    article: 'Bbl 4.30',
    element_global_id: 'abc-123',
    element_type: 'IfcWall',
    element_name: 'WL-204',
    status: 'fail',
    message: 'WBDBO below 60 min',
    actual_value: 45,
    expected_value: 60,
    property_set: 'Pset_WallCommon',
    property_name: 'FireRating',
    severity: 'critical',
  },
];

describe('RulesBreakdown', () => {
  it('renders English filter buttons and rule data', () => {
    render(
      <IntlWrapper locale="en">
        <RulesBreakdown rules={rules} details={details} />
      </IntlWrapper>,
    );

    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Pass')).toBeInTheDocument();
    expect(screen.getByText('Skip')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 rules')).toBeInTheDocument();

    expect(screen.getByText('Fire compartment separation')).toBeInTheDocument();
    expect(screen.getByText('Accessibility sector')).toBeInTheDocument();

    expect(screen.getByText(/Bbl 4\.30/)).toBeInTheDocument();
    expect(screen.getByText(/Fire safety/)).toBeInTheDocument();
    expect(screen.getAllByText(/Accessibility/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders Dutch filter buttons and translates categories', () => {
    render(
      <IntlWrapper locale="nl">
        <RulesBreakdown rules={rules} details={details} />
      </IntlWrapper>,
    );

    expect(screen.getByText('Alle')).toBeInTheDocument();
    expect(screen.getByText('Geslaagd')).toBeInTheDocument();
    expect(screen.getByText('Overgeslagen')).toBeInTheDocument();
    expect(screen.getByText('2 van 2 regels')).toBeInTheDocument();

    expect(screen.getByText('Brandcompartimentscheiding')).toBeInTheDocument();
    expect(screen.getByText('Toegankelijkheidssector')).toBeInTheDocument();

    expect(screen.getByText(/Brandveiligheid/)).toBeInTheDocument();
    expect(screen.getAllByText(/Toegankelijkheid/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty filter state in English', () => {
    render(
      <IntlWrapper locale="en">
        <RulesBreakdown rules={[]} details={[]} />
      </IntlWrapper>,
    );

    expect(screen.getByText('No rules match this filter.')).toBeInTheDocument();
  });

  it('shows empty filter state in Dutch', () => {
    render(
      <IntlWrapper locale="nl">
        <RulesBreakdown rules={[]} details={[]} />
      </IntlWrapper>,
    );

    expect(screen.getByText('Geen regels komen overeen met dit filter.')).toBeInTheDocument();
  });
});
