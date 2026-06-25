'use client';

import { useQueryClient } from '@tanstack/react-query';
import * as Sentry from '@sentry/nextjs';
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
import { getAuthMe, switchOrganization as switchOrgApi } from '@/lib/api/organizations';
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
          await queryClient.invalidateQueries();
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
      return;
    }
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
    }),
    [tokens, setTokens, hasHydrated, me, meError, refreshMe, activeMembership, switchOrganization],
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
