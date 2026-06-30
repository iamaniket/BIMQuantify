import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { type ReactNode } from 'react';

import type { TokenPair } from '@/lib/api/schemas';
import {
  setViewerTarget,
  useViewerSelectionStore,
} from '@/features/viewer/shared/viewerSelectionStore';

import { useFindings, useFileFindings } from './useFindings';

// Regression for the viewer 409 ("Error getting findings for free user in
// viewer"). These hooks read `tokens` (via useAuthInfiniteQuery) AND `me` (via
// useIsFreeUser) from useAuth, then branch the free vs paid endpoint on
// `me.active_organization_id`. `h.me === null` models the pre-`/auth/me` window
// (ready=false) — the window where, before the `ready` gate, the hook fired the
// org-only paid endpoint with isFreeUser=false and 409'd for a free user.
const h = vi.hoisted(() => ({
  tokens: null as TokenPair | null,
  me: null as { active_organization_id: string | null } | null,
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ tokens: h.tokens, me: h.me }),
}));

const listFindings = vi.fn();
vi.mock('@/lib/api/findings', () => ({
  listFindings: (...args: unknown[]) => listFindings(...args) as unknown,
}));

const listFreeProjectSnags = vi.fn();
vi.mock('@/lib/api/freeProjects', () => ({
  listFreeProjectSnags: (...args: unknown[]) => listFreeProjectSnags(...args) as unknown,
}));

const listFreeFindings = vi.fn();
vi.mock('@/lib/api/freeFindings', () => ({
  listFreeFindings: (...args: unknown[]) => listFreeFindings(...args) as unknown,
}));

function tok(access: string): TokenPair {
  return { access_token: access, refresh_token: `r-${access}`, token_type: 'bearer' };
}

function makeWrapper(): (props: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  h.tokens = tok('A');
  h.me = null;
  listFindings.mockReset();
  listFindings.mockResolvedValue({ data: [], totalCount: 0 });
  listFreeProjectSnags.mockReset();
  listFreeProjectSnags.mockResolvedValue([]);
  listFreeFindings.mockReset();
  listFreeFindings.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
  // Reset the viewer selection store so a single-mode target set in one test
  // doesn't leak the container id into the next.
  useViewerSelectionStore.setState({ byProject: {} });
});

describe('useFindings free-context gating', () => {
  it('defers (no fetch) until /auth/me has loaded (me === null, ready=false)', async () => {
    h.me = null;
    renderHook(() => useFindings('p1'), { wrapper: makeWrapper() });
    await Promise.resolve();
    // The regression: before the `ready` gate the paid endpoint fired here with
    // isFreeUser=false → 409 NO_ACTIVE_ORGANIZATION for a free user.
    expect(listFindings).not.toHaveBeenCalled();
    expect(listFreeProjectSnags).not.toHaveBeenCalled();
  });

  it('calls the FREE board feed for a free (org-less) user, never the paid endpoint', async () => {
    h.me = { active_organization_id: null };
    renderHook(() => useFindings('p1'), { wrapper: makeWrapper() });
    await waitFor(() => { expect(listFreeProjectSnags).toHaveBeenCalledTimes(1); });
    expect(listFindings).not.toHaveBeenCalled();
  });

  it('calls the paid findings endpoint for an org (paid) user', async () => {
    h.me = { active_organization_id: 'org1' };
    renderHook(() => useFindings('p1'), { wrapper: makeWrapper() });
    await waitFor(() => { expect(listFindings).toHaveBeenCalledTimes(1); });
    expect(listFreeProjectSnags).not.toHaveBeenCalled();
  });
});

describe('useFileFindings free-context gating', () => {
  it('defers (no fetch) until /auth/me has loaded', async () => {
    h.me = null;
    renderHook(() => useFileFindings('p1', 'file1'), { wrapper: makeWrapper() });
    await Promise.resolve();
    expect(listFindings).not.toHaveBeenCalled();
    expect(listFreeFindings).not.toHaveBeenCalled();
  });

  it('calls the paid endpoint with linked_file_id for an org (paid) user', async () => {
    h.me = { active_organization_id: 'org1' };
    renderHook(() => useFileFindings('p1', 'file1'), { wrapper: makeWrapper() });
    await waitFor(() => { expect(listFindings).toHaveBeenCalledTimes(1); });
    expect(listFindings).toHaveBeenCalledWith(
      'A', 'p1', expect.objectContaining({ linkedFileId: 'file1' }),
    );
  });

  it('lists the container snags for a free user, never the paid endpoint', async () => {
    h.me = { active_organization_id: null };
    renderHook(() => useFileFindings('p1', 'file1'), { wrapper: makeWrapper() });
    await waitFor(() => { expect(listFreeFindings).toHaveBeenCalledTimes(1); });
    expect(listFindings).not.toHaveBeenCalled();
  });

  it('lists by the CONTAINER id (free_document_id), not the file id', async () => {
    // Regression for the free-viewer marker 404: free snags are container-scoped
    // (`/free/documents/{container}/findings`), so the hook must resolve the open
    // single-mode container (modelId), NOT pass the file id into the document slot.
    h.me = { active_organization_id: null };
    setViewerTarget('p1', { kind: 'single', modelId: 'container1', fileId: 'file1' });
    renderHook(() => useFileFindings('p1', 'file1'), { wrapper: makeWrapper() });
    await waitFor(() => { expect(listFreeFindings).toHaveBeenCalledTimes(1); });
    expect(listFreeFindings).toHaveBeenCalledWith('A', 'container1');
  });
});
