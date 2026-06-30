import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TokenPair } from '@/lib/api/schemas';

import { useUpdateFinding } from './useUpdateFinding';

// POOL-CLIENT-2 regression: portal dropped `resolution_evidence_ids` / `photo_ids`
// when mapping a free finding update to the pooled payload, so a free user could
// upload resolution evidence but it was never linked to the snag. The free branch
// now threads both fields through to `updatePooledFinding`.
const h = vi.hoisted(() => ({
  tokens: null as TokenPair | null,
  me: null as { active_organization_id: string | null } | null,
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ tokens: h.tokens, me: h.me }),
}));

const updateFinding = vi.fn();
vi.mock('@/lib/api/findings', () => ({
  updateFinding: (...args: unknown[]) => updateFinding(...args) as unknown,
}));

const updatePooledFinding = vi.fn();
vi.mock('@/lib/api/pooledFindings', () => ({
  updatePooledFinding: (...args: unknown[]) => updatePooledFinding(...args) as unknown,
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
  h.me = { active_organization_id: null };
  updateFinding.mockReset();
  updateFinding.mockResolvedValue({});
  updatePooledFinding.mockReset();
  updatePooledFinding.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useUpdateFinding free resolve flow (POOL-CLIENT-2)', () => {
  it('threads resolution_evidence_ids to the pooled update, never the paid endpoint', async () => {
    const { result } = renderHook(() => useUpdateFinding('p1'), { wrapper: makeWrapper() });
    await result.current.mutateAsync({
      findingId: 'f1',
      input: { status: 'resolved', resolution_evidence_ids: ['a1', 'a2'] },
    });
    expect(updatePooledFinding).toHaveBeenCalledWith(
      'A',
      'f1',
      expect.objectContaining({ status: 'resolved', resolution_evidence_ids: ['a1', 'a2'] }),
    );
    expect(updateFinding).not.toHaveBeenCalled();
  });

  it('routes an org (paid) user to the paid update endpoint', async () => {
    h.me = { active_organization_id: 'org1' };
    const { result } = renderHook(() => useUpdateFinding('p1'), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ findingId: 'f1', input: { status: 'resolved' } });
    expect(updateFinding).toHaveBeenCalledTimes(1);
    expect(updatePooledFinding).not.toHaveBeenCalled();
  });
});
