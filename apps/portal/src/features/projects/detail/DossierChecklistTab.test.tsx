import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';
import type { JurisdictionDossierRequirement } from '@/lib/api/jurisdictions';

// --- UI primitives (passthroughs that forward the props we assert on) ---
vi.mock('@bimstitch/ui', () => ({
  Button: ({
    children,
    onClick,
    title,
    disabled,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    title?: string;
    disabled?: boolean;
    variant?: string;
  }) => (
    <button type="button" onClick={onClick} title={title} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
  Skeleton: () => <div data-testid="skeleton" />,
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./CertificateUploadDialog', () => ({ CertificateUploadDialog: () => null }));

const mockUseProject = vi.fn();
const mockUseJurisdiction = vi.fn();
const mockUseAttachments = vi.fn();
const mockUseUnslotted = vi.fn();
const mockUseCertificates = vi.fn();
const mockUseModels = vi.fn();
const mockUseFindings = vi.fn();
const mockUseDeadlines = vi.fn();
const mockUpload = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/features/projects/useProject', () => ({ useProject: () => mockUseProject() }));
vi.mock('@/features/jurisdictions/useJurisdictions', () => ({
  useJurisdiction: () => mockUseJurisdiction(),
}));
vi.mock('@/features/attachments/useAttachments', () => ({
  useAttachments: () => mockUseAttachments(),
  useUnslottedDocuments: () => mockUseUnslotted(),
}));
vi.mock('@/features/attachments/useUploadAttachment', () => ({
  useUploadAttachment: () => ({ mutate: mockUpload, isPending: false }),
}));
vi.mock('@/features/attachments/useUpdateAttachment', () => ({
  useUpdateAttachment: () => ({ mutate: mockUpdate, isPending: false }),
}));
vi.mock('@/features/certificates/useCertificates', () => ({
  useCertificates: () => mockUseCertificates(),
}));
vi.mock('@/features/models/useModels', () => ({ useModels: () => mockUseModels() }));
vi.mock('@/features/findings/useFindings', () => ({ useFindings: () => mockUseFindings() }));
vi.mock('./deadlines/useDeadlines', () => ({ useDeadlines: () => mockUseDeadlines() }));

import { DossierChecklistTab } from './DossierChecklistTab';

function infiniteData<T>(items: T[]) {
  return { pages: [{ data: items, totalCount: items.length }], pageParams: [0] };
}

const TEMPLATE: JurisdictionDossierRequirement[] = [
  {
    code: 'drawings',
    category: 'documents',
    label: 'Drawings',
    required: true,
    source_kind: 'attachment_slot',
    source_value: 'drawings',
  },
  {
    code: 'product-certificates',
    category: 'certificates',
    label: 'Product certificates',
    required: true,
    source_kind: 'certificate_type',
    source_value: 'product',
  },
];

const JURISDICTION = {
  dossier_requirement_templates: { dwelling: TEMPLATE, other: TEMPLATE },
  dossier_category_labels: { documents: 'Documents', certificates: 'Certificates' },
};

function renderTab(): void {
  render(
    <IntlWrapper>
      <DossierChecklistTab projectId="p1" country="NL" />
    </IntlWrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProject.mockReturnValue({ data: { building_type: 'dwelling', country: 'NL' }, isLoading: false });
  mockUseJurisdiction.mockReturnValue(JURISDICTION);
  mockUseAttachments.mockReturnValue({ data: infiniteData([]), isLoading: false });
  mockUseUnslotted.mockReturnValue({ data: [], isLoading: false });
  mockUseCertificates.mockReturnValue({ data: infiniteData([]), isLoading: false });
  mockUseModels.mockReturnValue({ data: [] });
  mockUseFindings.mockReturnValue({ data: infiniteData([]) });
  mockUseDeadlines.mockReturnValue({ data: [] });
});

describe('DossierChecklistTab', () => {
  it('renders category groups and requirement labels with a 0% bar when nothing is uploaded', () => {
    renderTab();
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('Certificates')).toBeInTheDocument();
    expect(screen.getByText('Drawings')).toBeInTheDocument();
    expect(screen.getByText('Product certificates')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    // Both required items missing.
    expect(screen.getAllByText('Missing').length).toBeGreaterThanOrEqual(2);
  });

  it('reflects a fulfilled requirement once a matching document exists', () => {
    mockUseAttachments.mockReturnValue({
      data: infiniteData([{ status: 'ready', dossier_slot: 'drawings' }]),
      isLoading: false,
    });
    renderTab();
    // 1 of 2 required complete → 50%.
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1 document provided')).toBeInTheDocument();
  });

  it('shows the empty state when no template is configured', () => {
    mockUseJurisdiction.mockReturnValue({
      dossier_requirement_templates: {},
      dossier_category_labels: {},
    });
    renderTab();
    expect(screen.getByText('No dossier checklist available')).toBeInTheDocument();
  });

  it('opens the link-existing dialog and links a chosen document', () => {
    mockUseUnslotted.mockReturnValue({
      data: [{ id: 'a1', original_filename: 'plattegrond.pdf' }],
      isLoading: false,
    });
    renderTab();

    // Click the "Link an existing document" button on the drawings row.
    fireEvent.click(screen.getAllByTitle('Link an existing document')[0]!);

    // Dialog opens and lists the untagged document.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const docButton = screen.getByText('plattegrond.pdf');
    fireEvent.click(docButton);

    expect(mockUpdate).toHaveBeenCalledWith(
      { attachmentId: 'a1', input: { dossier_slot: 'drawings' } },
      expect.anything(),
    );
  });

  it('renders dossier upload actions as primary buttons', () => {
    renderTab();

    expect(screen.getByRole('button', { name: 'Upload' })).toHaveAttribute('data-variant', 'primary');
    expect(screen.getByRole('button', { name: 'Upload certificate' })).toHaveAttribute('data-variant', 'primary');
  });
});
