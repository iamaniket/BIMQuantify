import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';
import type { Report, ReportType } from '@/lib/api/schemas/reports';

/* ---- mocks ---------------------------------------------------------- */

const useReportsMock = vi.fn();
const generateMutateMock = vi.fn();
const signMutateMock = vi.fn();

vi.mock('@/features/reports/hooks', () => ({
  useReports: (...args: unknown[]) => useReportsMock(...args),
  useReport: () => ({ data: undefined }),
  useGenerateReport: () => ({ mutate: generateMutateMock, isPending: false, error: null }),
  useSignReport: () => ({ mutate: signMutateMock, isPending: false }),
}));

vi.mock('@/features/permissions', () => ({
  useProjectPermissions: () => ({ can: () => true }),
}));

vi.mock('@/features/reportTemplates/hooks', () => ({
  useReportTemplates: () => ({ data: [] }),
}));

// Every icon used across the rendered tree resolves to a tiny stub component.
vi.mock('@bimstitch/ui/icons', () => {
  const Stub = (): ReactNode => <span />;
  return {
    Search: Stub,
    Download: Stub,
    ExternalLink: Stub,
    FileText: Stub,
    X: Stub,
    Sparkles: Stub,
    Check: Stub,
    PenLine: Stub,
    ClipboardCheck: Stub,
    FolderOpen: Stub,
    ShieldCheck: Stub,
  };
});

// Lightweight stand-ins so the test exercises component logic, not Radix.
vi.mock('@bimstitch/ui', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Button: ({ children, onClick, disabled }: {
      children?: ReactNode; onClick?: () => void; disabled?: boolean;
    }) => <button type="button" onClick={onClick} disabled={disabled}>{children}</button>,
    CountChip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Eyebrow: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Spinner: () => <span data-testid="spinner" />,
    Skeleton: () => <span />,
    Input: ({ value, onChange, placeholder }: {
      value?: string; onChange?: (e: unknown) => void; placeholder?: string;
    }) => <input value={value} onChange={onChange} placeholder={placeholder} />,
    Select: ({ value, onChange, children }: {
      value?: string; onChange?: (e: unknown) => void; children?: ReactNode;
    }) => <select value={value} onChange={onChange}>{children}</select>,
    EmptyState: ({ title, description, action }: {
      title: string; description?: string; action?: ReactNode;
    }) => <div><p>{title}</p><p>{description}</p>{action}</div>,
    SplitButton: ({ label, onClick, items }: {
      label: string;
      onClick: () => void;
      items: { id: string; label: string; onSelect: () => void }[];
    }) => (
      <div>
        <button type="button" onClick={onClick}>{label}</button>
        {items.map((it) => (
          <button key={it.id} type="button" onClick={it.onSelect}>{it.label}</button>
        ))}
      </div>
    ),
    DetailCard: Pass,
    DetailCardRow: ({ media, actions, info, children }: {
      media?: ReactNode; actions?: ReactNode; info?: ReactNode; children?: ReactNode;
    }) => <div>{media}{children}{info}{actions}</div>,
    DetailCardBody: Pass,
    Dialog: Pass,
    DialogBody: Pass,
    DialogClose: Pass,
    DialogContent: Pass,
    DialogHeader: Pass,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  };
});

// RowActionPill (pulled in by ReportTypeCard) imports next-intl's Link via
// createNavigation, which isn't resolvable under the test DOM — stub it.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import { RapportenTab } from '@/features/projects/detail/RapportenTab';

/* ---- helpers -------------------------------------------------------- */

function makeReport(over: Partial<Report> & Pick<Report, 'id' | 'report_type'>): Report {
  return {
    project_id: 'p1',
    status: 'ready',
    title: 'Report',
    locale: 'en',
    job_id: null,
    source_job_id: null,
    template_id: null,
    storage_key: null,
    byte_size: 12345,
    sha256: null,
    error: null,
    download_url: 'https://example.test/report.pdf',
    created_at: '2026-06-19T10:00:00Z',
    finished_at: null,
    signed_at: null,
    signed_by_user_id: null,
    signature_hash: null,
    ...over,
  };
}

function setReports(items: Report[]): void {
  useReportsMock.mockReturnValue({ data: { items, total: items.length }, isLoading: false });
}

function renderTab(locale: 'nl' | 'en' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IntlWrapper locale={locale}>
        <RapportenTab projectId="p1" />
      </IntlWrapper>
    </QueryClientProvider>,
  );
}

const r = (id: string, type: ReportType, over: Partial<Report> = {}): Report =>
  makeReport({ id, report_type: type, ...over });

/* ---- tests ---------------------------------------------------------- */

describe('RapportenTab', () => {
  beforeEach(() => {
    useReportsMock.mockReset();
    generateMutateMock.mockReset();
    signMutateMock.mockReset();
  });

  it('groups reports by type and hides types with no reports', () => {
    // API returns newest-first: two compliance generations + one assurance.
    setReports([
      r('c2', 'compliance_report'),
      r('c1', 'compliance_report'),
      r('a1', 'assurance_plan'),
    ]);
    renderTab('en');

    // Only the two present types render cards (each shows a generate-new-version
    // action); completion_declaration + dossier are absent.
    expect(screen.getAllByText('Generate new version')).toHaveLength(2);
    // Versions are numbered oldest→newest, the head tagged latest.
    expect(screen.getByText('v02')).toBeInTheDocument();
    expect(screen.getAllByText('v01')).toHaveLength(2); // compliance v01 + assurance v01
    expect(screen.getAllByText('Latest')).toHaveLength(2); // one head per card
  });

  it('shows the empty state with the generate split-button when there are no reports', () => {
    setReports([]);
    renderTab('en');
    expect(screen.getByText('No reports generated yet')).toBeInTheDocument();
    // The split-button primary is offered even on the empty state.
    expect(screen.getAllByText('Generate compliance report').length).toBeGreaterThan(0);
  });

  it('generates the primary type and a dropdown type via the split-button', () => {
    setReports([r('c1', 'compliance_report')]);
    renderTab('en');

    fireEvent.click(screen.getByText('Generate compliance report'));
    fireEvent.click(screen.getByText('Generate assurance plan'));

    expect(generateMutateMock).toHaveBeenCalledTimes(2);
    expect(generateMutateMock.mock.calls[0]![0]).toMatchObject({ report_type: 'compliance_report' });
    expect(generateMutateMock.mock.calls[1]![0]).toMatchObject({ report_type: 'assurance_plan' });
  });

  it('offers the inspector sign action on a ready, unsigned declaration', () => {
    setReports([r('d1', 'completion_declaration', { status: 'ready', signed_at: null })]);
    renderTab('en');

    const signButton = screen.getByText('Sign');
    fireEvent.click(signButton);
    expect(signMutateMock).toHaveBeenCalledWith('d1');
  });
});
