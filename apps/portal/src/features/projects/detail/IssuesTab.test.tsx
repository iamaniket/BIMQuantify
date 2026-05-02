import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

import type { ComplianceIssue } from '@/features/projects/compliance/types';

vi.mock('@bimstitch/ui', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('./IssueDetailModal', () => ({
  IssueDetailModal: () => null,
}));

import { IssuesTab } from './IssuesTab';

const issues: ComplianceIssue[] = [
  {
    id: 'I-2041',
    bblCode: 'Bbl 4.30',
    severity: 'fail',
    objectName: 'WL-204 (wand)',
    location: 'B3 · sector 2',
    modelDiscipline: 'FIRE',
    owner: 'M. Janssen',
    createdAt: '2h',
    requirementText: 'WBDBO ≥ 60 minuten.',
  },
  {
    id: 'I-2036',
    bblCode: 'Bbl 4.40',
    severity: 'warn',
    objectName: 'Route R-08',
    location: 'B1 → uitgang',
    modelDiscipline: 'ARCH',
    owner: 'B. Akkerman',
    createdAt: '5h',
    requirementText: 'Vluchtroute breedte ≥ 850mm.',
  },
];

describe('IssuesTab', () => {
  it('renders English column headers, filter buttons, and issue data', () => {
    render(
      <IntlWrapper locale="en">
        <IssuesTab issues={issues} />
      </IntlWrapper>,
    );

    expect(screen.getByText('Sev.')).toBeInTheDocument();
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Object')).toBeInTheDocument();
    expect(screen.getByText('Location')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();

    expect(screen.getByText('All')).toBeInTheDocument();

    expect(screen.getByText('FAIL')).toBeInTheDocument();
    expect(screen.getByText('WARN')).toBeInTheDocument();
    expect(screen.getByText('I-2041')).toBeInTheDocument();
    expect(screen.getByText('WL-204 (wand)')).toBeInTheDocument();
    expect(screen.getByText('I-2036')).toBeInTheDocument();
    expect(screen.getByText('Route R-08')).toBeInTheDocument();

    expect(screen.getByPlaceholderText('Search issues…')).toBeInTheDocument();
  });

  it('renders Dutch column headers when locale is nl', () => {
    render(
      <IntlWrapper locale="nl">
        <IssuesTab issues={issues} />
      </IntlWrapper>,
    );

    expect(screen.getByText('Ernst')).toBeInTheDocument();
    expect(screen.getByText('Locatie')).toBeInTheDocument();
    expect(screen.getByText('Leeftijd')).toBeInTheDocument();
    expect(screen.getByText('FOUT')).toBeInTheDocument();
    expect(screen.getByText('WRSCH')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Zoek bevindingen…')).toBeInTheDocument();
  });

  it('shows empty state when no issues match', () => {
    render(
      <IntlWrapper locale="en">
        <IssuesTab issues={[]} />
      </IntlWrapper>,
    );

    expect(screen.getByText('No issues match your filter.')).toBeInTheDocument();
  });

  it('shows Dutch empty state', () => {
    render(
      <IntlWrapper locale="nl">
        <IssuesTab issues={[]} />
      </IntlWrapper>,
    );

    expect(screen.getByText('Geen bevindingen komen overeen met uw filter.')).toBeInTheDocument();
  });
});
