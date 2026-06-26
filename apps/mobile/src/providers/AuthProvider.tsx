import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiError } from '@/lib/api/client';
import { getAuthMe, switchOrganization as switchOrgApi } from '@/lib/api/auth';
import { tokenManager } from '@/lib/api/tokenManager';
import { readStoredTokens, writeStoredTokens } from '@/lib/auth/secureStore';
import { readCachedMe, writeCachedMe } from '@/lib/auth/cachedMe';
import { wipeAllOfflineData } from '@/lib/offline/db';
import type {
  AuthMeResponse,
  OrgMembershipBrief,
  TokenPair,
} from '@/lib/api/schemas/auth';

// RN port of apps/portal/src/providers/AuthProvider.tsx. Same contract; the only
// change is async hydration from expo-secure-store (the `hasHydrated` gate
// already models this) and dropping web analytics.
type AuthState = {
  tokens: TokenPair | null;
  setTokens: (tokens: TokenPair | null) => void;
  hasHydrated: boolean;
  me: AuthMeResponse | null;
  refreshMe: () => Promise<void>;
  activeMembership: OrgMembershipBrief | null;
  switchOrganization: (organizationId: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [tokens, setTokensState] = useState<TokenPair | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const tokensRef = useRef<TokenPair | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // Restore tokens AND the cached /auth/me together, seeding `me` BEFORE
      // flipping hasHydrated so the auth gate sees a non-null `me` on the same
      // render — an offline returning user reaches the cached project list
      // instead of an infinite spinner. (Only seed with a live session.)
      const [stored, cachedMe] = await Promise.all([readStoredTokens(), readCachedMe()]);
      if (!active) return;
      tokensRef.current = stored;
      setTokensState(stored);
      if (stored !== null && cachedMe !== null) setMe(cachedMe);
      setHasHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const refreshMe = useCallback(async (): Promise<void> => {
    const current = tokensRef.current;
    if (current === null) {
      setMe(null);
      return;
    }
    try {
      const next = await getAuthMe(current.access_token);
      setMe(next);
      void writeCachedMe(next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        try {
          const newToken = await tokenManager.refresh();
          const next = await getAuthMe(newToken);
          setMe(next);
          void writeCachedMe(next);
          await queryClient.invalidateQueries();
        } catch {
          // Refresh failed — tokenManager already cleared tokens; routes redirect.
        }
        return;
      }
      // Connectivity blip (non-ApiError) — keep the hydrated/cached `me`. This
      // no-op is what makes offline session-restore work: we never clobber a
      // seeded `me`, and never trigger tokenManager.refresh() offline (which
      // would clear tokens and log the user out).
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
  }, [hasHydrated, tokens]); // eslint-disable-line react-hooks/exhaustive-deps -- refreshMe is stable

  const setTokens = useCallback((next: TokenPair | null): void => {
    tokensRef.current = next;
    void writeStoredTokens(next);
    setTokensState(next);
    // Logout wipes all offline data — a shared, multi-tenant device must not
    // keep one user's cached snags/findings into the next session.
    if (next === null) {
      void wipeAllOfflineData();
    }
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
      // Clear the previous org's cached data before adopting the new tenant
      // context — the offline cache isn't org-scoped, so a switch must reset it.
      await wipeAllOfflineData();
      setTokens(nextTokens);
      await queryClient.invalidateQueries();
      // /auth/me re-fetches via the effect watching `tokens`.
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
      refreshMe,
      activeMembership,
      switchOrganization,
    }),
    [tokens, setTokens, hasHydrated, me, refreshMe, activeMembership, switchOrganization],
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
