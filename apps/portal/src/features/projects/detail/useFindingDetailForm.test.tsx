import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Finding } from '@/lib/api/schemas';

import { useFindingDetailForm } from './useFindingDetailForm';

const h = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  members: [] as Array<{ user_id: string; role: string }>,
  me: { user: { id: 'u1' } },
}));

vi.mock('@/features/findings/useUpdateFinding', () => ({
  useUpdateFinding: () => ({ mutate: h.updateMutate, isPending: false }),
}));
vi.mock('@/features/findings/useDeleteFinding', () => ({
  useDeleteFinding: () => ({ mutate: h.deleteMutate, isPending: false }),
}));
vi.mock('@/features/projects/members/useProjectMembers', () => ({
  useProjectMembers: () => ({ data: h.members, isLoading: false }),
}));
vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ me: h.me }),
}));

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

describe('useFindingDetailForm', () => {
  beforeEach(() => {
    h.updateMutate.mockClear();
    h.deleteMutate.mockClear();
    h.members = [];
    h.me = { user: { id: 'u1' } };
  });

  it('gates promote on a draft having both assignee and deadline', () => {
    const draftReady = renderHook(() =>
      useFindingDetailForm('p1', makeFinding({ status: 'draft', assignee_user_id: 'u2', deadline_date: '2026-07-01' })),
    );
    expect(draftReady.result.current.canPromote).toBe(true);

    const draftBare = renderHook(() =>
      useFindingDetailForm('p1', makeFinding({ status: 'draft' })),
    );
    expect(draftBare.result.current.canPromote).toBe(false);
  });

  it('shows + gates the resolve flow only for open / in-progress findings', () => {
    const open = renderHook(() =>
      useFindingDetailForm('p1', makeFinding({ status: 'open', resolution_note: 'fixed', resolution_evidence_ids: ['a'] })),
    );
    expect(open.result.current.showResolve).toBe(true);
    expect(open.result.current.canResolve).toBe(true);

    const draft = renderHook(() => useFindingDetailForm('p1', makeFinding({ status: 'draft' })));
    expect(draft.result.current.showResolve).toBe(false);

    const openNoEvidence = renderHook(() =>
      useFindingDetailForm('p1', makeFinding({ status: 'open', resolution_note: 'fixed' })),
    );
    expect(openNoEvidence.result.current.canResolve).toBe(false);
  });

  it('marks resolved/verified findings as resolved', () => {
    const resolved = renderHook(() => useFindingDetailForm('p1', makeFinding({ status: 'resolved' })));
    expect(resolved.result.current.isResolved).toBe(true);
    expect(resolved.result.current.showResolve).toBe(false);
  });

  it('flags inspector membership and element links', () => {
    h.members = [{ user_id: 'u1', role: 'inspector' }];
    const linked = renderHook(() =>
      useFindingDetailForm('p1', makeFinding({ linked_element_global_id: 'GID1' })),
    );
    expect(linked.result.current.isInspector).toBe(true);
    expect(linked.result.current.isLinked).toBe(true);

    h.members = [{ user_id: 'u1', role: 'editor' }];
    const unlinked = renderHook(() => useFindingDetailForm('p1', makeFinding()));
    expect(unlinked.result.current.isInspector).toBe(false);
    expect(unlinked.result.current.isLinked).toBe(false);
  });

  it('verify() patches status, remove() deletes by id', () => {
    const finding = makeFinding({ status: 'resolved' });
    const { result } = renderHook(() => useFindingDetailForm('p1', finding));

    act(() => { result.current.verify(); });
    expect(h.updateMutate).toHaveBeenCalledWith(
      { findingId: 'finding-1', input: { status: 'verified' } },
      expect.anything(),
    );

    act(() => { result.current.remove(); });
    expect(h.deleteMutate).toHaveBeenCalledWith('finding-1', expect.anything());
  });
});
