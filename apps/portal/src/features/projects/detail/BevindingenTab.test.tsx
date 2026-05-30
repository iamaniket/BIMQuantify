import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

import type { Finding } from '@/lib/api/schemas';

vi.mock('@bimstitch/ui', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Skeleton: () => <div data-testid="skeleton" />,
  EmptyState: ({
    title,
    description,
    action,
  }: {
    title: string;
    description: string;
    action?: React.ReactNode;
  }) => (
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  ),
}));

vi.mock('./FindingFormDialog', () => ({ FindingFormDialog: () => null }));
vi.mock('./FindingDetailModal', () => ({ FindingDetailModal: () => null }));

const mockUseFindings = vi.fn();
vi.mock('@/features/findings/useFindings', () => ({
  useFindings: () => mockUseFindings(),
}));

import { BevindingenTab } from './BevindingenTab';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    project_id: '22222222-2222-2222-2222-222222222222',
    title: 'Brandwerende doorvoer ontbreekt',
    description: 'Doorvoer niet brandwerend afgewerkt.',
    severity: 'high',
    status: 'open',
    assignee_user_id: null,
    deadline_date: '2026-06-15',
    bbl_article_ref: '4.51',
    created_by_user_id: '33333333-3333-3333-3333-333333333333',
    source_checklist_item_id: null,
    borgingsmoment_id: null,
    linked_file_id: null,
    linked_element_global_id: null,
    photo_ids: null,
    resolution_note: null,
    resolution_evidence_ids: null,
    created_at: '2026-05-29T10:00:00Z',
    updated_at: '2026-05-29T10:00:00Z',
    ...overrides,
  };
}

describe('BevindingenTab', () => {
  it('renders the empty state with a create CTA (English)', () => {
    mockUseFindings.mockReturnValue({ data: [], isLoading: false });

    render(
      <IntlWrapper locale="en">
        <BevindingenTab projectId="p1" />
      </IntlWrapper>,
    );

    expect(screen.getByText('No findings logged')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log finding/ })).toBeInTheDocument();
  });

  it('renders a list of findings with severity and status labels (English)', () => {
    mockUseFindings.mockReturnValue({
      data: [makeFinding(), makeFinding({
        id: '44444444-4444-4444-4444-444444444444',
        title: 'Ventilatiekanaal te krap',
        severity: 'medium',
        status: 'in_progress',
      })],
      isLoading: false,
    });

    render(
      <IntlWrapper locale="en">
        <BevindingenTab projectId="p1" />
      </IntlWrapper>,
    );

    expect(screen.getByText('Brandwerende doorvoer ontbreekt')).toBeInTheDocument();
    expect(screen.getByText('Ventilatiekanaal te krap')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('renders Dutch severity/status labels when locale is nl', () => {
    mockUseFindings.mockReturnValue({
      data: [makeFinding({ severity: 'high', status: 'in_progress' })],
      isLoading: false,
    });

    render(
      <IntlWrapper locale="nl">
        <BevindingenTab projectId="p1" />
      </IntlWrapper>,
    );

    expect(screen.getByText('Hoog')).toBeInTheDocument();
    expect(screen.getByText('In behandeling')).toBeInTheDocument();
  });

  it('shows skeletons while loading', () => {
    mockUseFindings.mockReturnValue({ data: undefined, isLoading: true });

    render(
      <IntlWrapper locale="en">
        <BevindingenTab projectId="p1" />
      </IntlWrapper>,
    );

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });
});
