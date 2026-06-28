import { refreshAccessToken } from '@/lib/api/auth';
import type { TokenPair } from '@/lib/api/schemas/auth';

// Storage-agnostic singleton, ported verbatim from the portal. The AuthProvider
// registers getter/setter callbacks; this dedupes concurrent refreshes.
type GetTokens = () => TokenPair | null;
type SetTokens = (tokens: TokenPair | null) => void;

class TokenManager {
  private getTokens: GetTokens | null = null;

  private setTokens: SetTokens | null = null;

  private refreshPromise: Promise<string> | null = null;

  register(getTokens: GetTokens, setTokens: SetTokens): void {
    this.getTokens = getTokens;
    this.setTokens = setTokens;
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
        // presented one is now retired — reusing it would trip reuse detection
        // and sign the user out everywhere. Fall back only if none was returned.
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
