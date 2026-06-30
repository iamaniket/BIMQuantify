import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';

import type { TokenPair } from '@/lib/api/schemas';

import { useAttachments, useFileAttachmentCount } from './useAttachments';

// `useAttachments` reads `tokens` (via useAuthInfiniteQuery) AND `me` (via
// useIsPooledContext) from useAuth. We drive both: `h.me === null` models the
// pre-`/auth/me` window, `active_organization_id === null` models a free
// (org-less) caller, a non-null id models a paid caller.
const h = vi.hoisted(() => ({
  tokens: null as TokenPair | null,
  me: null as { active_organization_id: string | null } | null,
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ tokens: h.tokens, me: h.me }),
}));

const listAttachments = vi.fn();
vi.mock('@/lib/api/attachments', () => ({
  listAttachments: (...args: unknown[]) => listAttachments(...args) as unknown,
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
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ data: [], totalCount: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAttachments free-context gating', () => {
  it('does NOT call the paid attachments endpoint for a free (org-less) user', async () => {
    h.me = { active_organization_id: null };
    const { result } = renderHook(() => useFileAttachmentCount('p1', 'f1'), {
      wrapper: makeWrapper(),
    });
    // Disabled query → count is 0 and the paid endpoint (which 409s for an
    // org-less caller) is never hit.
    expect(result.current).toBe(0);
    await Promise.resolve();
    expect(listAttachments).not.toHaveBeenCalled();
  });

  it('calls the paid attachments endpoint for an org (paid) user', async () => {
    h.me = { active_organization_id: 'org1' };
    listAttachments.mockResolvedValue({ data: [{ id: 'a' }], totalCount: 1 });
    const { result } = renderHook(() => useFileAttachmentCount('p1', 'f1'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => { expect(listAttachments).toHaveBeenCalledTimes(1); });
    await waitFor(() => { expect(result.current).toBe(1); });
  });

  it('defers (no fetch) until /auth/me has loaded (me === null, ready=false)', async () => {
    h.me = null;
    renderHook(() => useAttachments('p1'), { wrapper: makeWrapper() });
    await Promise.resolve();
    expect(listAttachments).not.toHaveBeenCalled();
  });
});
