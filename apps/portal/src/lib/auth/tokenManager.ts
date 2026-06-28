import { refreshAccessToken } from '@/lib/api/auth';
import type { TokenPair } from '@/lib/api/schemas';

type GetTokens = () => TokenPair | null;
type SetTokens = (tokens: TokenPair | null) => void;

export class TokenManager {
  private getTokens: GetTokens | null = null;

  private setTokens: SetTokens | null = null;

  private refreshPromise: Promise<string> | null = null;

  register(getTokens: GetTokens, setTokens: SetTokens): void {
    this.getTokens = getTokens;
    this.setTokens = setTokens;
  }

  /**
   * Live access token from the registered getter (`AuthProvider`'s
   * `tokensRef.current`). Read this inside query/mutation fns so a token that
   * changed *after* render — a cross-tab org switch (audit #4) or a refresh — is
   * honored instead of a stale render-time capture (audit #11); using the stale
   * token would fire against the previous tenant's schema.
   *
   * `fallback` is returned ONLY before a getter is registered (the brief
   * first-load window before `AuthProvider`'s register effect runs); once
   * registered, a `null` result is authoritative (logged out) and the fallback
   * is ignored, so a logout never resurrects a stale token.
   */
  getAccessToken(fallback: string | null = null): string | null {
    if (this.getTokens === null) return fallback;
    const tokens = this.getTokens();
    return tokens === null ? null : tokens.access_token;
  }

  async refresh(): Promise<string> {
    if (this.refreshPromise !== null) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<string> {
    const tokens = this.getTokens?.() ?? null;
    if (tokens === null) {
      throw new Error('No tokens available for refresh');
    }

    try {
      const { accessToken, refreshToken } = await refreshAccessToken(tokens.refresh_token);
      const updated: TokenPair = {
        ...tokens,
        access_token: accessToken,
        // Refresh-token rotation: adopt the server's new refresh token. The
        // presented one is now retired — keeping it would trip reuse detection
        // on the next refresh and sign the user out everywhere. Fall back to the
        // existing token only if a non-rotating server returned none.
        refresh_token: refreshToken ?? tokens.refresh_token,
      };
      this.setTokens?.(updated);
      return accessToken;
    } catch {
      this.setTokens?.(null);
      throw new Error('Session expired');
    }
  }
}

export const tokenManager = new TokenManager();
