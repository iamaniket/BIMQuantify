import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { type ReactNode } from 'react';

import type { TokenPair } from '@/lib/api/schemas';

import { useProject } from './useProject';

// Regression for the viewer 409 on `GET /projects/{id}` for a free user. Mirrors
// the documents/levels/aligned-sheets `useAuthQuery` hooks: they branch the
// `/free/*` vs `/projects/*` prefix on `me.active_organization_id`. `h.me ===
// null` is the pre-`/auth/me` window (ready=false) where, before the `ready`
// gate, the org-only endpoint fired with free=false and 409'd for a free user.
const h = vi.hoisted(() => ({
  tokens: null as TokenPair | null,
  me: null as { active_organization_id: string | null } | null,
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ tokens: h.tokens, me: h.me }),
}));

const getProject = vi.fn();
vi.mock('@/lib/api/projects', () => ({
  getProject: (...args: unknown[]) => getProject(...args) as unknown,
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
  getProject.mockReset();
  getProject.mockResolvedValue({ id: 'p1' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useProject free-context gating', () => {
  it('defers (no fetch) until /auth/me has loaded (me === null, ready=false)', async () => {
    h.me = null;
    renderHook(() => useProject('p1'), { wrapper: makeWrapper() });
    await Promise.resolve();
    // The regression: before the `ready` gate this fired `/projects/{id}` with
    // free=false → 409 NO_ACTIVE_ORGANIZATION for a free user.
    expect(getProject).not.toHaveBeenCalled();
  });

  it('fetches the FREE project (free=true) for an org-less user', async () => {
    h.me = { active_organization_id: null };
    renderHook(() => useProject('p1'), { wrapper: makeWrapper() });
    await waitFor(() => { expect(getProject).toHaveBeenCalledTimes(1); });
    expect(getProject).toHaveBeenCalledWith('A', 'p1', true);
  });

  it('fetches the paid project (free=false) for an org user', async () => {
    h.me = { active_organization_id: 'org1' };
    renderHook(() => useProject('p1'), { wrapper: makeWrapper() });
    await waitFor(() => { expect(getProject).toHaveBeenCalledTimes(1); });
    expect(getProject).toHaveBeenCalledWith('A', 'p1', false);
  });
});
