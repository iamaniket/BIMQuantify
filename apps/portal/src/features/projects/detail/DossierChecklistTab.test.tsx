import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';
import type { JurisdictionDossierRequirement } from '@/lib/api/jurisdictions';

// --- UI primitives (passthroughs that forward the props we assert on) ---
vi.mock('@bimdossier/ui', () => ({
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
const mockUseModelsWithVersions = vi.fn();
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
vi.mock('@/features/documents/useDocumentsWithVersions', () => ({
  useDocumentsWithVersions: () => mockUseModelsWithVersions(),
}));
vi.mock('@/features/findings/useFindings', () => ({ useFindings: () => mockUseFindings() }));
vi.mock('./deadlines/useDeadlines', () => ({ useDeadlines: () => mockUseDeadlines() }));

import { DossierChecklistTab } from './DossierChecklistTab';

function infiniteData<T>(items: T[]) {
  return { pages: [{ data: items, totalCount: items.length }], pageParams: [0] };
}

// Drawings is model-backed; structural-calculations exercises the attachment
// upload/link CTAs; product-certificates the certificate CTA.
const TEMPLATE: JurisdictionDossierRequirement[] = [
  {
    code: 'drawings',
    category: 'documents',
    label: 'Drawings',
    required: true,
    source_kind: 'model',
    source_value: 'models',
  },
  {
    code: 'structural-calculations',
    category: 'documents',
    label: 'Structural calculations',
    required: true,
    source_kind: 'attachment_slot',
    source_value: 'structural_calculations',
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

/** A model whose head file is a ready, fully-extracted IFC (viewable). */
const VIEWABLE_MODEL = {
  id: 'm1',
  versions: [{ file_type: 'ifc', status: 'ready', extraction_status: 'succeeded' }],
};
/** A model whose IFC is still extracting — present but not yet viewable. */
const PROCESSING_MODEL = {
  id: 'm1',
  versions: [{ file_type: 'ifc', status: 'ready', extraction_status: 'queued' }],
};

function renderTab(onNavigateToModels: () => void = () => {}): void {
  render(
    <IntlWrapper>
      <DossierChecklistTab projectId="p1" country="NL" onNavigateToModels={onNavigateToModels} />
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
  mockUseModelsWithVersions.mockReturnValue({ data: [] });
  mockUseFindings.mockReturnValue({ data: infiniteData([]) });
  mockUseDeadlines.mockReturnValue({ data: [] });
});

describe('DossierChecklistTab', () => {
  it('renders category groups and requirement labels when nothing is uploaded', () => {
    renderTab();
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('Certificates')).toBeInTheDocument();
    expect(screen.getByText('Drawings')).toBeInTheDocument();
    expect(screen.getByText('Structural calculations')).toBeInTheDocument();
    expect(screen.getByText('Product certificates')).toBeInTheDocument();
    // All three required items missing. (The headline percentage now lives in
    // the Readiness tab header — see RightColumnTabs — not in this tab.)
    expect(screen.getAllByText('Missing').length).toBeGreaterThanOrEqual(3);
  });

  it('reflects a fulfilled attachment requirement once a matching document exists', () => {
    mockUseAttachments.mockReturnValue({
      data: infiniteData([{ status: 'ready', dossier_slot: 'structural_calculations' }]),
      isLoading: false,
    });
    renderTab();
    expect(screen.getByText('1 document provided')).toBeInTheDocument();
  });

  it('marks the drawings row fulfilled from a viewable model (no attachment)', () => {
    mockUseModelsWithVersions.mockReturnValue({ data: [VIEWABLE_MODEL] });
    renderTab();
    // Drawings is met by the processed model — no "Add model" CTA on the row.
    expect(screen.queryByRole('button', { name: 'Add model' })).not.toBeInTheDocument();
    expect(screen.getByText('1 document provided')).toBeInTheDocument();
  });

  it('shows Add model on the drawings row and navigates to Models when no model exists', () => {
    const onNavigate = vi.fn();
    renderTab(onNavigate);

    const addModel = screen.getByRole('button', { name: 'Add model' });
    expect(addModel).toHaveAttribute('data-variant', 'primary');
    fireEvent.click(addModel);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('hides the drawings CTA while a model exists but is still processing', () => {
    mockUseModelsWithVersions.mockReturnValue({ data: [PROCESSING_MODEL] });
    renderTab();
    // A model is present, so no button — but it isn't viewable yet, so missing.
    expect(screen.queryByRole('button', { name: 'Add model' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Missing').length).toBeGreaterThanOrEqual(1);
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
      data: [{ id: 'a1', original_filename: 'berekening.pdf' }],
      isLoading: false,
    });
    renderTab();

    // The only attachment-slot row (structural calculations) carries the Link CTA.
    fireEvent.click(screen.getAllByTitle('Link an existing document')[0]!);

    // Dialog opens and lists the untagged document.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('berekening.pdf'));

    expect(mockUpdate).toHaveBeenCalledWith(
      { attachmentId: 'a1', input: { dossier_slot: 'structural_calculations' } },
      expect.anything(),
    );
  });

  it('renders dossier upload actions as primary buttons', () => {
    renderTab();

    expect(screen.getByRole('button', { name: 'Upload' })).toHaveAttribute('data-variant', 'primary');
    expect(screen.getByRole('button', { name: 'Upload certificate' })).toHaveAttribute('data-variant', 'primary');
    expect(screen.getByRole('button', { name: 'Add model' })).toHaveAttribute('data-variant', 'primary');
  });
});
