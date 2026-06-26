import * as SecureStore from 'expo-secure-store';

import { TokenPairSchema, type TokenPair } from '@/lib/api/schemas/auth';

// expo-secure-store replaces the portal's localStorage. Same logical key; keys
// may contain only [A-Za-z0-9._-], which "bimdossier.tokens" satisfies.
const STORAGE_KEY = 'bimdossier.tokens';

export async function readStoredTokens(): Promise<TokenPair | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = TokenPairSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeStoredTokens(tokens: TokenPair | null): Promise<void> {
  try {
    if (tokens === null) {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    } else {
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(tokens));
    }
  } catch {
    // SecureStore may be unavailable (e.g. no keychain in some emulators);
    // fall back to in-memory only, matching the portal's localStorage guard.
  }
}
