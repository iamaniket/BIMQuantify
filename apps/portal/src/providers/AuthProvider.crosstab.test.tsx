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

import { AuthProvider, useAuth } from './AuthProvider';

const STORAGE_KEY = 'bimdossier.tokens';

function tok(access: string): { access_token: string; refresh_token: string; token_type: string } {
  return { access_token: access, refresh_token: `r-${access}`, token_type: 'bearer' };
}

function Probe(): React.JSX.Element {
  const { tokens, hasHydrated } = useAuth();
  return (
    <div data-testid="tok">
      {hasHydrated ? (tokens?.access_token ?? 'NONE') : 'HYDRATING'}
    </div>
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
});
