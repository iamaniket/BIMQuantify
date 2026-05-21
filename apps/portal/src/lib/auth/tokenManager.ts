import { refreshAccessToken } from '@/lib/api/auth';
import type { TokenPair } from '@/lib/api/schemas';

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
      const newAccessToken = await refreshAccessToken(tokens.refresh_token);
      const updated: TokenPair = {
        ...tokens,
        access_token: newAccessToken,
      };
      this.setTokens?.(updated);
      return newAccessToken;
    } catch {
      this.setTokens?.(null);
      throw new Error('Session expired');
    }
  }
}

export const tokenManager = new TokenManager();
