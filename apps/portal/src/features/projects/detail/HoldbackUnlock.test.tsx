import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

vi.mock('@bimstitch/ui', () => ({
  Progress: ({ value }: { value: number }) => (
    <div data-testid="progress" data-value={value} />
  ),
}));

import { HoldbackUnlock } from './HoldbackUnlock';

describe('HoldbackUnlock', () => {
  it('renders English labels with interpolated values', () => {
    render(
      <IntlWrapper locale="en">
        <HoldbackUnlock holdbackAmount="€ 184,500" dossierPct={85} />
      </IntlWrapper>,
    );

    expect(screen.getByText('Holdback unlock')).toBeInTheDocument();
    expect(screen.getByText('€ 184,500')).toBeInTheDocument();
    expect(screen.getByText('Dossier 85%')).toBeInTheDocument();
    expect(screen.getByText('15% to go')).toBeInTheDocument();
  });

  it('renders Dutch labels when locale is nl', () => {
    render(
      <IntlWrapper locale="nl">
        <HoldbackUnlock holdbackAmount="€ 184,500" dossierPct={72} />
      </IntlWrapper>,
    );

    expect(screen.getByText('Vrijgave depot')).toBeInTheDocument();
    expect(screen.getByText('Dossier 72%')).toBeInTheDocument();
    expect(screen.getByText('28% resterend')).toBeInTheDocument();
  });
});
