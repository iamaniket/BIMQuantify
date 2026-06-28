import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// happy-dom 20 doesn't provide a working `window.localStorage` in this runner,
// so install a minimal in-memory Storage. The provider reads `window.localStorage`,
// so the test and the provider share this one store.
class MemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

// Mock the provider's external dependencies so we can exercise the real
// AuthProvider (and its cross-tab `storage` listener) in isolation.
vi.mock('@/lib/auth/tokenManager', () => ({
  tokenManager: { register: vi.fn(), refresh: vi.fn(async () => 'new-access') },
}));
vi.mock('@/lib/api/organizations', () => ({
  getAuthMe: vi.fn(async () => ({ active_organization_id: null, memberships: [] })),
  switchOrganization: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({
  PORTAL_EVENTS: { ORGANIZATION_SWITCHED: 'org_switched' },
  track: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { getAuthMe } from '@/lib/api/organizations';
import type { AuthMeResponse } from '@/lib/api/schemas';

import { AuthProvider, useAuth } from './AuthProvider';

const STORAGE_KEY = 'bimdossier.tokens';
const mockGetAuthMe = vi.mocked(getAuthMe);

function tok(access: string): { access_token: string; refresh_token: string; token_type: string } {
  return { access_token: access, refresh_token: `r-${access}`, token_type: 'bearer' };
}

/** A parseable (unsigned) JWT carrying an `org` claim, so the provider's
 * `orgClaimOf` can read it the way a real access token would. */
function jwtForOrg(
  org: string,
  nonce = 's',
): { access_token: string; refresh_token: string; token_type: string } {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ org })).toString('base64url');
  return tok(`${header}.${payload}.${nonce}`);
}

/** A promise whose resolution the test controls, so we can observe the
 * in-flight (pre-resolution) state of an /auth/me refetch. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Minimal /auth/me payload for the given active org. Cast loosely — the Probe
 * only reads `active_organization_id`. */
function meFor(org: string): AuthMeResponse {
  return { active_organization_id: org, memberships: [] } as unknown as AuthMeResponse;
}

function Probe(): React.JSX.Element {
  const { tokens, hasHydrated, me } = useAuth();
  return (
    <>
      <div data-testid="tok">
        {hasHydrated ? (tokens?.access_token ?? 'NONE') : 'HYDRATING'}
      </div>
      <div data-testid="me">{me === null ? 'NOME' : (me.active_organization_id ?? 'NOORG')}</div>
    </>
  );
}

function renderProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return spy;
}

function fireStorage(key: string | null): void {
  // happy-dom doesn't auto-fire `storage` for same-window writes (matching real
  // browsers), so dispatch it manually — the handler re-reads localStorage.
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key }));
  });
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AuthProvider cross-tab token sync', () => {
  it('adopts the new token when another tab switches org', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tok('A')));
    const invalidate = renderProvider();
    await waitFor(() => expect(screen.getByTestId('tok')).toHaveTextContent('A'));

    // Another tab wrote a fresh token (new JWT `org` claim). Without the
    // listener this tab would keep token A and read the wrong tenant.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tok('B')));
    fireStorage(STORAGE_KEY);

    await waitFor(() => expect(screen.getByTestId('tok')).toHaveTextContent('B'));
    // Cache is dropped so no stale-tenant data renders under the new token.
    expect(invalidate).toHaveBeenCalled();
  });

  it('clears tokens when another tab logs out', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tok('A')));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('tok')).toHaveTextContent('A'));

    window.localStorage.removeItem(STORAGE_KEY);
    fireStorage(STORAGE_KEY);

    await waitFor(() => expect(screen.getByTestId('tok')).toHaveTextContent('NONE'));
  });

  it('ignores storage events for unrelated keys', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tok('A')));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('tok')).toHaveTextContent('A'));

    window.localStorage.setItem('unrelated.key', 'x');
    fireStorage('unrelated.key');

    expect(screen.getByTestId('tok')).toHaveTextContent('A');
  });

  // M-fe2: after a cross-tab org switch the previous org's profile (name/role)
  // must NOT keep rendering during the /auth/me refetch gap.
  it('drops the stale profile while /auth/me re-fetches a different org', async () => {
    const pending = deferred<AuthMeResponse>();
    mockGetAuthMe.mockResolvedValueOnce(meFor('org-1')); // initial load
    mockGetAuthMe.mockReturnValueOnce(pending.promise); // post-switch (held)

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jwtForOrg('org-1')));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('me')).toHaveTextContent('org-1'));

    // Another tab switched to org-2; this tab adopts the token. /auth/me is
    // in-flight (held), so the only correct render is "loading", not org-1.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jwtForOrg('org-2')));
    fireStorage(STORAGE_KEY);
    await waitFor(() => expect(screen.getByTestId('me')).toHaveTextContent('NOME'));

    pending.resolve(meFor('org-2'));
    await waitFor(() => expect(screen.getByTestId('me')).toHaveTextContent('org-2'));
  });

  // The complement: a same-org cross-tab token refresh (new access token, same
  // `org` claim) must keep the profile so it doesn't needlessly flash to loading.
  it('keeps the profile on a same-org token refresh', async () => {
    const pending = deferred<AuthMeResponse>();
    mockGetAuthMe.mockResolvedValueOnce(meFor('org-1')); // initial load
    mockGetAuthMe.mockReturnValueOnce(pending.promise); // post-refresh (held)

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jwtForOrg('org-1', 's1')));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('me')).toHaveTextContent('org-1'));

    // Same org, fresh access token (rotated in another tab).
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jwtForOrg('org-1', 's2')));
    fireStorage(STORAGE_KEY);

    // The refetch still fires, but `me` never blanks — org is unchanged.
    await waitFor(() => expect(mockGetAuthMe).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('me')).toHaveTextContent('org-1');
  });
});
