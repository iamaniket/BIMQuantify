'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { getAuthMe, switchOrganization as switchOrgApi } from '@/lib/api/organizations';
import {
  TokenPairSchema,
  type AuthMeResponse,
  type OrgMembershipBrief,
  type TokenPair,
} from '@/lib/api/schemas';

const STORAGE_KEY = 'bimstitch.tokens';

type AuthState = {
  tokens: TokenPair | null;
  setTokens: (tokens: TokenPair | null) => void;
  hasHydrated: boolean;
  /** Profile + memberships, fetched lazily after the tokens hydrate. `null`
   * before the first /auth/me response; consumers should treat that as
   * "loading" rather than "no memberships". */
  me: AuthMeResponse | null;
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
  const [tokens, setTokensState] = useState<TokenPair | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [me, setMe] = useState<AuthMeResponse | null>(null);

  useEffect(() => {
    setTokensState(readStoredTokens());
    setHasHydrated(true);
  }, []);

  const refreshMe = useCallback(async (): Promise<void> => {
    const current = tokens;
    if (current === null) {
      setMe(null);
      return;
    }
    try {
      const next = await getAuthMe(current.access_token);
      setMe(next);
    } catch {
      // Stale token, network blip — leave the existing snapshot rather than
      // clearing it. The caller can re-attempt via refreshMe() if needed.
    }
  }, [tokens]);

  // Fetch /auth/me whenever the access token changes (login, refresh, switch).
  useEffect(() => {
    if (!hasHydrated) return;
    if (tokens === null) {
      setMe(null);
      return;
    }
    void refreshMe();
  }, [hasHydrated, tokens, refreshMe]);

  const setTokens = useCallback((next: TokenPair | null): void => {
    writeStoredTokens(next);
    setTokensState(next);
  }, []);

  const switchOrganization = useCallback(
    async (organizationId: string): Promise<void> => {
      const current = tokens;
      if (current === null) {
        throw new Error('Cannot switch organization without an active session');
      }
      const nextTokens = await switchOrgApi(organizationId, current.access_token);
      setTokens(nextTokens);
      // /auth/me will be re-fetched by the effect that watches `tokens`.
    },
    [tokens, setTokens],
  );

  const activeMembership = useMemo<OrgMembershipBrief | null>(() => {
    if (me === null || me.active_organization_id === null) return null;
    return (
      me.memberships.find((m) => m.organization_id === me.active_organization_id) ?? null
    );
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
