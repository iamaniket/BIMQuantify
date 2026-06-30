import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';
import type { Finding } from '@/lib/api/schemas';

const q = vi.hoisted(() => ({
  file: {
    // Widened so `setFile()` (Partial<typeof q.file>) accepts real infinite-query data,
    // not just `undefined`. The runtime value is still undefined.
    data: undefined as unknown,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  },
}));

vi.mock('@/features/findings/useFindings', () => ({
  useFileFindings: () => q.file,
  useProjectFindings: () => ({
    data: undefined,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock('@/features/findings/useElementFindings', () => ({
  useElementFindings: () => ({
    data: undefined,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock('@/features/findingTemplates/useFindingTemplates', () => ({
  useFindingTemplates: () => ({ data: [] }),
}));
vi.mock('@/components/shared/resource/LoadMoreButton', () => ({
  LoadMoreButton: () => null,
}));
vi.mock('@/features/projects/detail/FindingCreateForm', () => ({
  FindingCreateForm: () => <div>create-form</div>,
}));
vi.mock('@/features/projects/detail/FindingDetailForm', () => ({
  FindingDetailForm: ({ finding }: { finding: { id: string } }) => (
    <div>detail-form-{finding.id}</div>
  ),
}));

import { EntityFindingsBody } from './EntityFindingsBody';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'finding-1',
    project_id: 'p1',
    title: 'Doorvoer',
    description: 'Niet afgewerkt',
    severity: 'high',
    status: 'open',
    assignee_user_id: null,
    deadline_date: null,
    bbl_article_ref: null,
    created_by_user_id: 'u9',
    source_checklist_item_id: null,
    borgingsmoment_id: null,
    linked_document_id: null,
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
    template_id: null,
    custom_values: null,
    created_at: '2026-05-29T10:00:00Z',
    updated_at: '2026-05-29T10:00:00Z',
    ...overrides,
  };
}

function infiniteData(items: Finding[]) {
  return { pages: [{ data: items, totalCount: items.length }], pageParams: [0] };
}

function setFile(partial: Partial<typeof q.file>): void {
  q.file = { ...q.file, ...partial };
}

describe('EntityFindingsBody', () => {
  beforeEach(() => {
    setFile({ data: undefined, isLoading: false, hasNextPage: false, isFetchingNextPage: false });
  });

  it('toggles the inline create form from the toolbar (no dialog)', () => {
    setFile({ data: infiniteData([]) });
    render(
      <IntlWrapper locale="en">
        <EntityFindingsBody projectId="p1" scope={{ kind: 'file', fileId: 'f1' }} />
      </IntlWrapper>,
    );

    expect(screen.queryByText('create-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New finding/i }));
    expect(screen.getByText('create-form')).toBeInTheDocument();
  });

  it('expands a row to the editable form on click', () => {
    setFile({ data: infiniteData([makeFinding()]) });
    render(
      <IntlWrapper locale="en">
        <EntityFindingsBody projectId="p1" scope={{ kind: 'file', fileId: 'f1' }} />
      </IntlWrapper>,
    );

    expect(screen.queryByText('detail-form-finding-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Doorvoer'));
    expect(screen.getByText('detail-form-finding-1')).toBeInTheDocument();
  });

  it('expands the marker-clicked finding once its scoped query has loaded it', () => {
    // Marker click arrives while the scoped query is still loading.
    setFile({ data: undefined, isLoading: true });
    const { rerender } = render(
      <IntlWrapper locale="en">
        <EntityFindingsBody
          projectId="p1"
          scope={{ kind: 'file', fileId: 'f1' }}
          openFindingId="finding-1"
          openFindingNonce={1}
        />
      </IntlWrapper>,
    );
    expect(screen.queryByText('detail-form-finding-1')).not.toBeInTheDocument();

    // Data arrives → the expand effect re-fires and opens the row.
    setFile({ data: infiniteData([makeFinding()]), isLoading: false });
    rerender(
      <IntlWrapper locale="en">
        <EntityFindingsBody
          projectId="p1"
          scope={{ kind: 'file', fileId: 'f1' }}
          openFindingId="finding-1"
          openFindingNonce={1}
        />
      </IntlWrapper>,
    );
    expect(screen.getByText('detail-form-finding-1')).toBeInTheDocument();
  });
});
