import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';

import type { TokenPair } from '@/lib/api/schemas';
import { TokenManager, tokenManager } from '@/lib/auth/tokenManager';

import { useAuthMutation, useAuthQuery } from './useAuthQuery';

// useAuthQuery/useAuthMutation read the render-time token from useAuth (for the
// `enabled` gate + as a pre-registration fallback) and the LIVE token from the
// real tokenManager singleton inside the query/mutation fn. We control both
// independently: `h.tokens` is the render-time capture, the registered getter is
// the live value.
const h = vi.hoisted(() => ({ tokens: null as TokenPair | null }));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ tokens: h.tokens }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

function tok(access: string): TokenPair {
  return { access_token: access, refresh_token: `r-${access}`, token_type: 'bearer' };
}

function makeWrapper(): {
  queryClient: QueryClient;
  wrapper: (props: { children: ReactNode }) => ReactNode;
} {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, wrapper };
}

beforeEach(() => {
  h.tokens = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TokenManager.getAccessToken', () => {
  it('returns the fallback until a getter is registered, then the live token, null when logged out', () => {
    const tm = new TokenManager();
    // No getter registered yet (first-load window) → use the render-time fallback.
    expect(tm.getAccessToken('render')).toBe('render');

    let current: TokenPair | null = tok('A');
    tm.register(() => current, vi.fn());
    // Registered → live token wins, the fallback is ignored.
    expect(tm.getAccessToken('render')).toBe('A');

    current = tok('B');
    expect(tm.getAccessToken('render')).toBe('B');

    // Logged out → null is authoritative; the stale fallback must NOT resurrect.
    current = null;
    expect(tm.getAccessToken('render')).toBeNull();
  });
});

describe('useAuthQuery (#11 — live token on refetch)', () => {
  it('a refetch after an org switch uses the live token, not the render-captured one', async () => {
    let live: TokenPair | null = tok('A');
    tokenManager.register(() => live, vi.fn());
    h.tokens = tok('A'); // render-time capture

    const seen: string[] = [];
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useAuthQuery<string>({
          queryKey: ['thing'],
          queryFn: async (t) => {
            seen.push(t);
            return t;
          },
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toEqual(['A']);

    // Another tab switched org: tokensRef.current (the live getter) is now 'B',
    // but this hook's render-captured token is still 'A'. The refetch that #4's
    // listener triggers must fire with the live token.
    live = tok('B');
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['thing'] });
    });

    // The refetch fired with the LIVE token and its result landed in the cache.
    // `seen` is the essential assertion: it records the token the queryFn ran
    // with (before the fix this was ['A', 'A'] — the stale render-time capture).
    expect(seen).toEqual(['A', 'B']);
    expect(queryClient.getQueryData(['thing'])).toBe('B');
  });
});

describe('useAuthMutation (#11 — live token on mutate)', () => {
  it('a mutation fired after a token change uses the live token', async () => {
    let live: TokenPair | null = tok('A');
    tokenManager.register(() => live, vi.fn());
    h.tokens = tok('A'); // render-time capture

    const seen: string[] = [];
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useAuthMutation<string, string>({
          mutationFn: async (t, v) => {
            seen.push(t);
            return v;
          },
        }),
      { wrapper },
    );

    // Token changed (refresh / cross-tab switch) after this hook last rendered.
    live = tok('B');
    await act(async () => {
      await result.current.mutateAsync('payload');
    });

    expect(seen).toEqual(['B']); // before the fix this was ['A']
  });
});
