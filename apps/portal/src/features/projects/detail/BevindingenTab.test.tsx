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
  // The findings list renders through DetailCard + FindingRow. Collapsed cards
  // hide their body/footer, so the mocks render only the always-visible row.
  DetailCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DetailCardRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DetailCardBody: () => null,
  DetailCardFooter: () => null,
  MetaGrid: () => null,
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// next-intl's createNavigation pulls in `next/navigation`, which isn't fully
// resolvable under happy-dom — stub Link (the findings board link) with an anchor.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('./FindingFormDialog', () => ({ FindingFormDialog: () => null }));
vi.mock('./FindingDetailModal', () => ({ FindingDetailModal: () => null }));

const mockUseFindings = vi.fn();
vi.mock('@/features/findings/useFindings', () => ({
  useFindings: () => mockUseFindings(),
}));

vi.mock('@/features/projects/members/useProjectMembers', () => ({
  useProjectMembers: () => ({ data: [] }),
}));

vi.mock('@/features/findings/useDeleteFinding', () => ({
  useDeleteFinding: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { BevindingenTab } from './BevindingenTab';

function infiniteData<T>(items: T[]) {
  return { pages: [{ data: items, totalCount: items.length }], pageParams: [0] };
}

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
    linked_model_id: null,
    linked_file_id: null,
    linked_element_global_id: null,
    linked_file_type: null,
    anchor_x: null,
    anchor_y: null,
    anchor_z: null,
    anchor_page: null,
    photo_ids: null,
    resolution_note: null,
    resolution_evidence_ids: null,
    reference_attachment_ids: null,
    created_at: '2026-05-29T10:00:00Z',
    updated_at: '2026-05-29T10:00:00Z',
    ...overrides,
  };
}

describe('BevindingenTab', () => {
  it('renders the empty state with a create CTA (English)', () => {
    mockUseFindings.mockReturnValue({ data: infiniteData([]), isLoading: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() });

    render(
      <IntlWrapper locale="en">
        <BevindingenTab projectId="p1" />
      </IntlWrapper>,
    );

    expect(screen.getByText('No findings logged')).toBeInTheDocument();
    // The CTA appears both in the toolbar and the empty state — assert presence.
    expect(screen.getAllByRole('button', { name: /Log finding/ }).length).toBeGreaterThan(0);
  });

  it('renders a list of findings with severity and status labels (English)', () => {
    mockUseFindings.mockReturnValue({
      data: infiniteData([makeFinding(), makeFinding({
        id: '44444444-4444-4444-4444-444444444444',
        title: 'Ventilatiekanaal te krap',
        severity: 'medium',
        status: 'in_progress',
      })]),
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
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
      data: infiniteData([makeFinding({ severity: 'high', status: 'in_progress' })]),
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
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
    mockUseFindings.mockReturnValue({ data: undefined, isLoading: true, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() });

    render(
      <IntlWrapper locale="en">
        <BevindingenTab projectId="p1" />
      </IntlWrapper>,
    );

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });
});
