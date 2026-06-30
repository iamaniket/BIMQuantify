'use client';

import { useQueryClient } from '@tanstack/react-query';
import * as Sentry from '@sentry/nextjs';
import { jwtDecode } from 'jwt-decode';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { PORTAL_EVENTS, track } from '@/lib/analytics';
import { tokenManager } from '@/lib/auth/tokenManager';

import { ApiError } from '@/lib/api/client';
import {
  getAuthMe,
  switchOrganization as switchOrgApi,
  switchToFree as switchToFreeApi,
} from '@/lib/api/organizations';
import {
  TokenPairSchema,
  type AuthMeResponse,
  type OrgMembershipBrief,
  type TokenPair,
} from '@/lib/api/schemas';

const STORAGE_KEY = 'bimdossier.tokens';

type AuthState = {
  tokens: TokenPair | null;
  setTokens: (tokens: TokenPair | null) => void;
  hasHydrated: boolean;
  /** Profile + memberships, fetched lazily after the tokens hydrate. `null`
   * before the first /auth/me response; consumers should treat that as
   * "loading" rather than "no memberships". */
  me: AuthMeResponse | null;
  /** Set when a non-401 /auth/me fetch fails (5xx, network, validation). Lets
   * layouts distinguish "still loading" (`me === null && meError === null`)
   * from "the profile fetch failed" and surface a retry instead of silently
   * rendering a stale/empty org + role. Cleared on the next successful fetch. */
  meError: Error | null;
  /** Force a re-fetch of /auth/me. Useful right after invite acceptance,
   * org switch, or membership changes elsewhere in the app. */
  refreshMe: () => Promise<void>;
  /** Active org membership (or null if the user has no memberships yet). */
  activeMembership: OrgMembershipBrief | null;
  /** Switch the active org. Updates JWT, persists tokens, re-fetches /auth/me. */
  switchOrganization: (organizationId: string) => Promise<void>;
  /** Enter the org-less "Free workspace" (no org claim). Updates JWT, persists
   * tokens, re-fetches /auth/me. */
  switchToFree: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

type Props = {
  children: ReactNode;
};

function readStoredTokens(): TokenPair | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = TokenPairSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeStoredTokens(tokens: TokenPair | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (tokens === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    }
  } catch {
    // localStorage may be unavailable (private mode, quota); fall back to memory only.
  }
}

/** Active-org id from an access token's `org` claim (the tenant the JWT is
 * scoped to). Returns null on a malformed token — "can't tell" is treated as
 * "no specific org", which at worst triggers one extra /auth/me refresh, never
 * a wrong-org render. Mirrors the claim read in PostHogProvider. */
function orgClaimOf(accessToken: string | null | undefined): string | null {
  if (accessToken === null || accessToken === undefined) return null;
  try {
    return jwtDecode<{ org?: string }>(accessToken).org ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: Props): JSX.Element {
  const queryClient = useQueryClient();
  const [tokens, setTokensState] = useState<TokenPair | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [meError, setMeError] = useState<Error | null>(null);
  const tokensRef = useRef<TokenPair | null>(null);

  useEffect(() => {
    const stored = readStoredTokens();
    tokensRef.current = stored;
    setTokensState(stored);
    setHasHydrated(true);
  }, []);

  const refreshMe = useCallback(async (): Promise<void> => {
    const current = tokensRef.current;
    if (current === null) {
      setMe(null);
      setMeError(null);
      return;
    }
    try {
      const next = await getAuthMe(current.access_token);
      setMe(next);
      setMeError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        try {
          const newToken = await tokenManager.refresh();
          const next = await getAuthMe(newToken);
          setMe(next);
          setMeError(null);
          // A silent token refresh renews only the access token — no data
          // changed, so there is nothing to refetch. (Org switches, which DO
          // change tenant data, still invalidate via `switchOrganization`.)
        } catch {
          // Refresh failed — tokenManager already called setTokens(null),
          // layouts will redirect to /login.
        }
        return;
      }
      // Non-401 (5xx / network / validation): keep the previous snapshot so a
      // transient blip doesn't blow away org context, but record the error so
      // it isn't silent — layouts read `meError` to surface a retry, and after
      // an org switch a failed re-fetch is no longer an invisible stale-org bug.
      const err = error instanceof Error ? error : new Error(String(error));
      setMeError(err);
      Sentry.captureException(err, { tags: { source: 'auth.refreshMe' } });
    }
  }, [queryClient]);

  // Fetch /auth/me whenever the access token changes (login, refresh, switch).
  useEffect(() => {
    if (!hasHydrated) return;
    if (tokens === null) {
      setMe(null);
      setMeError(null);
      return;
    }
    // Drop the rendered profile when the token's active org no longer matches it
    // — an org switch in this tab (switchOrganization) or another (the cross-tab
    // `storage` handler below). Without this the previous org's name + role keep
    // rendering during the /auth/me refetch gap (M-fe2); since role/admin flags
    // derive from `me`, clearing drops to least-privilege (never briefly grants
    // elevated UI) and re-enters the same loading state layouts already handle on
    // first load. A same-org silent refresh keeps `me`, avoiding a needless flash.
    // Functional updater so `me` need not be an effect dep.
    const nextOrg = orgClaimOf(tokens.access_token);
    setMe((prev) => (prev !== null && nextOrg !== prev.active_organization_id ? null : prev));
    refreshMe().catch(() => undefined);
  }, [hasHydrated, tokens]); // eslint-disable-line react-hooks/exhaustive-deps -- refreshMe is stable (no state deps)

  const setTokens = useCallback((next: TokenPair | null): void => {
    tokensRef.current = next;
    writeStoredTokens(next);
    setTokensState(next);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    tokenManager.register(() => tokensRef.current, setTokens);
  }, [hasHydrated, setTokens]);

  // Cross-tab sync. The backend is schema-per-tenant keyed off the JWT `org`
  // claim, so a stale in-memory token in another tab silently reads/writes the
  // WRONG tenant's schema after an org switch (and keeps firing a dead token
  // after logout). The `storage` event fires in every OTHER tab when this key
  // changes; re-hydrate from it and drop all cached tenant data so nothing
  // renders under the previous org's token. We update state directly (not via
  // `setTokens`, which would write the same value back to localStorage and
  // echo the event). `e.key === null` covers `localStorage.clear()`.
  useEffect(() => {
    function onStorage(e: StorageEvent): void {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      const next = readStoredTokens();
      if ((next?.access_token ?? null) === (tokensRef.current?.access_token ?? null)) {
        return;
      }
      tokensRef.current = next;
      setTokensState(next);
      // Org switched (new tenant) or session ended in another tab. The effect
      // watching `tokens` re-fetches /auth/me; clearing the cache prevents the
      // previous org's data from lingering. On logout (next === null) the
      // route guards redirect to /login.
      void queryClient.invalidateQueries();
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient]);

  const switchOrganization = useCallback(
    async (organizationId: string): Promise<void> => {
      const current = tokensRef.current;
      if (current === null) {
        throw new Error('Cannot switch organization without an active session');
      }
      const nextTokens = await switchOrgApi(organizationId, current.access_token);
      setTokens(nextTokens);
      await queryClient.invalidateQueries();
      track(PORTAL_EVENTS.ORGANIZATION_SWITCHED, { organization_id: organizationId });
      // /auth/me will be re-fetched by the effect that watches `tokens`.
    },
    [setTokens, queryClient],
  );

  const switchToFree = useCallback(async (): Promise<void> => {
    const current = tokensRef.current;
    if (current === null) {
      throw new Error('Cannot switch to the free workspace without an active session');
    }
    const nextTokens = await switchToFreeApi(current.access_token);
    setTokens(nextTokens);
    await queryClient.invalidateQueries();
    track(PORTAL_EVENTS.ORGANIZATION_SWITCHED, { organization_id: 'free' });
    // /auth/me will be re-fetched by the effect that watches `tokens`.
  }, [setTokens, queryClient]);

  const activeMembership = useMemo<OrgMembershipBrief | null>(() => {
    if (me === null) return null;
    if (me.active_organization_id === null) return null;
    return me.memberships.find((m) => m.organization_id === me.active_organization_id) ?? null;
  }, [me]);

  const value = useMemo<AuthState>(
    () => ({
      tokens,
      setTokens,
      hasHydrated,
      me,
      meError,
      refreshMe,
      activeMembership,
      switchOrganization,
      switchToFree,
    }),
    [
      tokens,
      setTokens,
      hasHydrated,
      me,
      meError,
      refreshMe,
      activeMembership,
      switchOrganization,
      switchToFree,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
