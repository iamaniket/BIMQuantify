import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

// Hooks are mocked so the test exercises the *component*, not React Query
// or the network layer.
const useReportsMock = vi.fn();
const useReportMock = vi.fn();
const generateMutateMock = vi.fn();
const useGenerateReportMock = vi.fn(() => ({
  mutate: generateMutateMock,
  isPending: false,
  error: null,
}));

vi.mock('../hooks', () => ({
  useReports: (...args: unknown[]) => useReportsMock(...args),
  useReport: (...args: unknown[]) => useReportMock(...args),
  useGenerateReport: (...args: unknown[]) => useGenerateReportMock(...args),
}));

// Stub the UI Dialog primitives so jsdom doesn't choke on Radix portals — the
// component still renders its children but unwrapped.
vi.mock('@bimstitch/ui', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Button: ({ children, onClick, disabled }: {
      children: ReactNode; onClick?: () => void; disabled?: boolean;
    }) => (
      <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
    ),
    Dialog: passthrough,
    DialogBody: passthrough,
    DialogClose: ({ children }: { children?: ReactNode; asChild?: boolean }) => <>{children}</>,
    DialogContent: passthrough,
    DialogHeader: passthrough,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  };
});

import { ComplianceReportsSection } from '../ComplianceReportsSection';
import type { Report } from '@/lib/api/schemas/reports';

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    project_id: '22222222-2222-2222-2222-222222222222',
    report_type: 'compliance_report',
    status: 'ready',
    title: 'Nalevingsrapport — Test Project',
    locale: 'nl',
    job_id: '33333333-3333-3333-3333-333333333333',
    source_job_id: '44444444-4444-4444-4444-444444444444',
    storage_key: 'reports/x/y/r1.pdf',
    byte_size: 12345,
    sha256: 'a'.repeat(64),
    error: null,
    download_url: 'http://fake-storage/reports/x/y/r1.pdf?download=report.pdf',
    created_at: new Date(Date.now() - 60_000).toISOString(),
    finished_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderWith(ui: ReactNode, locale: 'nl' | 'en' = 'nl') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IntlWrapper locale={locale}>{ui}</IntlWrapper>
    </QueryClientProvider>,
  );
}

describe('ComplianceReportsSection', () => {
  beforeEach(() => {
    useReportsMock.mockReset();
    useReportMock.mockReset().mockReturnValue({ data: undefined });
    generateMutateMock.mockReset();
    useGenerateReportMock.mockClear();
  });

  it('shows the empty-state when there are no reports', () => {
    useReportsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });

    renderWith(<ComplianceReportsSection projectId="proj-1" />, 'nl');

    expect(screen.getByText('Genereer nalevingsrapport')).toBeInTheDocument();
    expect(screen.getByText('Nog geen rapporten gegenereerd')).toBeInTheDocument();
  });

  it('lists existing reports with their localized status pill', () => {
    useReportsMock.mockReturnValue({
      data: {
        items: [
          makeReport({ id: 'r1', status: 'ready', title: 'Rapport A' }),
          makeReport({ id: 'r2', status: 'running', title: 'Rapport B' }),
          makeReport({ id: 'r3', status: 'failed', title: 'Rapport C', error: 'CHROMIUM_OOM' }),
        ],
        total: 3,
      },
      isLoading: false,
    });

    renderWith(<ComplianceReportsSection projectId="proj-1" />, 'nl');

    expect(screen.getByText('Rapport A')).toBeInTheDocument();
    expect(screen.getByText('Rapport B')).toBeInTheDocument();
    expect(screen.getByText('Rapport C')).toBeInTheDocument();
    expect(screen.getByText('Gereed')).toBeInTheDocument();
    expect(screen.getByText('Wordt gegenereerd')).toBeInTheDocument();
    expect(screen.getByText('Mislukt')).toBeInTheDocument();
    // Failed report shows the error inline.
    expect(screen.getByText(/CHROMIUM_OOM/)).toBeInTheDocument();
  });

  it('renders a Download link only when storage_key is reachable via download_url', () => {
    useReportsMock.mockReturnValue({
      data: {
        items: [
          makeReport({ id: 'ready', status: 'ready' }),
          makeReport({
            id: 'queued',
            status: 'queued',
            storage_key: null,
            byte_size: null,
            sha256: null,
            download_url: null,
            finished_at: null,
          }),
        ],
        total: 2,
      },
      isLoading: false,
    });

    renderWith(<ComplianceReportsSection projectId="proj-1" />, 'nl');

    const downloads = screen.getAllByTitle('Download');
    expect(downloads).toHaveLength(1); // only the ready row has a download link
    expect(downloads[0]!.tagName).toBe('A');
    expect(downloads[0]!.getAttribute('href')).toContain('http://fake-storage/');
  });

  it('triggers the generate mutation when the button is clicked', () => {
    useReportsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });

    renderWith(<ComplianceReportsSection projectId="proj-1" />, 'nl');

    fireEvent.click(screen.getByText('Genereer nalevingsrapport'));

    expect(generateMutateMock).toHaveBeenCalledTimes(1);
    const [body] = generateMutateMock.mock.calls[0]!;
    expect(body).toEqual({
      report_type: 'compliance_report',
      locale: 'nl',
      params: {},
    });
  });

  it('disables the generate button while a generation is pending', () => {
    useReportsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    useGenerateReportMock.mockReturnValueOnce({
      mutate: generateMutateMock,
      isPending: true,
      error: null,
    });

    renderWith(<ComplianceReportsSection projectId="proj-1" />, 'nl');

    const button = screen.getByText('Genereer nalevingsrapport').closest('button')!;
    expect(button).toBeDisabled();
  });

  it('surfaces the NO_COMPLIANCE_DATA hint when the API rejects with 422', async () => {
    useReportsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });

    // Simulate the mutation's error state — same shape ApiError exposes.
    const apiError = Object.assign(new Error('NO_COMPLIANCE_DATA'), {
      name: 'ApiError',
      status: 422,
      detail: 'NO_COMPLIANCE_DATA',
      detailObject: null,
    });
    // ApiError is checked via instanceof — patch the prototype chain.
    const { ApiError } = await import('@/lib/api/client');
    Object.setPrototypeOf(apiError, ApiError.prototype);

    useGenerateReportMock.mockReturnValueOnce({
      mutate: generateMutateMock,
      isPending: false,
      error: apiError,
    });

    renderWith(<ComplianceReportsSection projectId="proj-1" />, 'nl');

    expect(
      screen.getByText(/Geen nalevingsgegevens beschikbaar/),
    ).toBeInTheDocument();
  });

  it('renders English copy when locale is en', () => {
    useReportsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });

    renderWith(<ComplianceReportsSection projectId="proj-1" />, 'en');

    expect(screen.getByText('Generate compliance report')).toBeInTheDocument();
    expect(screen.getByText('No reports generated yet')).toBeInTheDocument();
  });
});
