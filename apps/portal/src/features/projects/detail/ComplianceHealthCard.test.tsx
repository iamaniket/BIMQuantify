import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

import type { ComplianceSummary } from '@/features/projects/compliance/types';

vi.mock('@/components/BlueprintTexture', () => ({
  BlueprintTexture: () => <div data-testid="blueprint-texture" />,
}));

vi.mock('@bimstitch/ui', () => ({
  Progress: ({ value }: { value: number }) => (
    <div data-testid="progress" data-value={value} />
  ),
}));

vi.mock('./HoldbackUnlock', () => ({
  HoldbackUnlock: ({ holdbackAmount, dossierPct }: { holdbackAmount: string; dossierPct: number }) => (
    <div data-testid="holdback" data-amount={holdbackAmount} data-pct={dossierPct} />
  ),
}));

import { ComplianceHealthCard } from './ComplianceHealthCard';

const summary: ComplianceSummary = {
  passCount: 1109,
  warnCount: 79,
  failCount: 28,
  overallScore: 82,
  dossierPercentage: 85,
  lastScanAt: '2025-01-01T00:00:00Z',
};

describe('ComplianceHealthCard', () => {
  it('renders English labels and counter values', () => {
    render(
      <IntlWrapper locale="en">
        <ComplianceHealthCard summary={summary} holdbackAmount="€ 184,500" />
      </IntlWrapper>,
    );

    expect(screen.getByText('Compliance health')).toBeInTheDocument();
    expect(screen.getByText('Bbl scan summary')).toBeInTheDocument();
    expect(screen.getByText('Pass')).toBeInTheDocument();
    expect(screen.getByText('Warn')).toBeInTheDocument();
    expect(screen.getByText('Fail')).toBeInTheDocument();
    expect(screen.getByText('1,109')).toBeInTheDocument();
    expect(screen.getByText('79')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
  });

  it('renders Dutch labels when locale is nl', () => {
    render(
      <IntlWrapper locale="nl">
        <ComplianceHealthCard summary={summary} holdbackAmount="€ 184,500" />
      </IntlWrapper>,
    );

    expect(screen.getByText('Nalevingsstatus')).toBeInTheDocument();
    expect(screen.getByText('Bbl-scansamenvatting')).toBeInTheDocument();
    expect(screen.getByText('Geslaagd')).toBeInTheDocument();
    expect(screen.getByText('Waarschuwing')).toBeInTheDocument();
    expect(screen.getByText('Fout')).toBeInTheDocument();
  });

  it('passes holdback props through', () => {
    render(
      <IntlWrapper locale="en">
        <ComplianceHealthCard summary={summary} holdbackAmount="€ 184,500" />
      </IntlWrapper>,
    );

    const holdback = screen.getByTestId('holdback');
    expect(holdback).toHaveAttribute('data-amount', '€ 184,500');
    expect(holdback).toHaveAttribute('data-pct', '85');
  });
});
