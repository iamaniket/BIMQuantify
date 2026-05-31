import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

// Hooks are mocked so the test exercises the *component*, not React Query.
const useReportsMock = vi.fn();
const useReportMock = vi.fn();
const generateMutateMock = vi.fn();
const useGenerateReportMock = vi.fn();

vi.mock('../hooks', () => ({
  useReports: (...args: unknown[]) => useReportsMock(...args),
  useReport: (...args: unknown[]) => useReportMock(...args),
  useGenerateReport: (...args: unknown[]) => useGenerateReportMock(...args),
}));

vi.mock('@bimstitch/ui', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Button: ({ children, onClick, disabled }: {
      children: ReactNode; onClick?: () => void; disabled?: boolean;
    }) => (
      <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
    ),
    Spinner: () => <span data-testid="spinner" />,
    Dialog: passthrough,
    DialogBody: passthrough,
    DialogClose: ({ children }: { children?: ReactNode; asChild?: boolean }) => <>{children}</>,
    DialogContent: passthrough,
    DialogHeader: passthrough,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  };
});

import { ReportSection } from '../ReportSection';

function renderWith(ui: ReactNode, locale: 'nl' | 'en' = 'nl') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IntlWrapper locale={locale}>{ui}</IntlWrapper>
    </QueryClientProvider>,
  );
}

describe('ReportSection', () => {
  beforeEach(() => {
    useReportsMock.mockReset();
    useReportMock.mockReset().mockReturnValue({ data: undefined });
    generateMutateMock.mockReset();
    useGenerateReportMock.mockReset().mockImplementation(() => ({
      mutate: generateMutateMock,
      isPending: false,
      error: null,
    }));
  });

  it('renders the per-type title + generate button (compliance, nl)', () => {
    useReportsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    renderWith(<ReportSection projectId="p1" reportType="compliance_report" />, 'nl');
    expect(screen.getByText('Nalevingsrapport')).toBeInTheDocument();
    expect(screen.getByText('Genereer nalevingsrapport')).toBeInTheDocument();
    expect(screen.getByText('Nog geen rapporten gegenereerd')).toBeInTheDocument();
  });

  it('renders the borgingsplan title + generate button (assurance_plan, nl)', () => {
    useReportsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    renderWith(<ReportSection projectId="p1" reportType="assurance_plan" />, 'nl');
    expect(screen.getByText('Borgingsplan')).toBeInTheDocument();
    expect(screen.getByText('Genereer borgingsplan')).toBeInTheDocument();
  });

  it('passes the report type through to the generate mutation', () => {
    useReportsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    renderWith(<ReportSection projectId="p1" reportType="assurance_plan" />, 'nl');
    fireEvent.click(screen.getByText('Genereer borgingsplan'));
    expect(generateMutateMock).toHaveBeenCalledTimes(1);
    const [body] = generateMutateMock.mock.calls[0]!;
    expect(body).toEqual({ report_type: 'assurance_plan', locale: null, params: {} });
  });

  it('disables the generate button while a generation is pending', () => {
    useReportsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    useGenerateReportMock.mockReturnValue({ mutate: generateMutateMock, isPending: true, error: null });
    renderWith(<ReportSection projectId="p1" reportType="compliance_report" />, 'nl');
    const button = screen.getByText('Genereer nalevingsrapport').closest('button')!;
    expect(button).toBeDisabled();
  });

  it('surfaces the type-specific missing-data hint on a matching 422', async () => {
    useReportsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    const apiError = Object.assign(new Error('NO_ASSURANCE_PLAN'), {
      name: 'ApiError',
      status: 422,
      detail: 'NO_ASSURANCE_PLAN',
      detailObject: null,
    });
    const { ApiError } = await import('@/lib/api/client');
    Object.setPrototypeOf(apiError, ApiError.prototype);
    useGenerateReportMock.mockReturnValue({
      mutate: generateMutateMock,
      isPending: false,
      error: apiError as Error,
    });
    renderWith(
      <ReportSection projectId="p1" reportType="assurance_plan" missingDataDetail="NO_ASSURANCE_PLAN" />,
      'nl',
    );
    expect(screen.getByText(/Nog geen borgingsplan/)).toBeInTheDocument();
  });

  it('renders English copy when locale is en', () => {
    useReportsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    renderWith(<ReportSection projectId="p1" reportType="compliance_report" />, 'en');
    expect(screen.getByText('Compliance report')).toBeInTheDocument();
    expect(screen.getByText('Generate compliance report')).toBeInTheDocument();
    expect(screen.getByText('No reports generated yet')).toBeInTheDocument();
  });
});
