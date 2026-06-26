import { getMeta, setMeta } from '@/lib/offline/outbox';
import { AuthMeResponseSchema, type AuthMeResponse } from '@/lib/api/schemas/auth';

// Durable cache of the last successful GET /auth/me, so a previously-authenticated
// user can cold-launch OFFLINE and land on the project list instead of an
// infinite spinner (the gate needs a non-null `me`). Stored in the SQLite
// `sync_meta` KV (not expo-secure-store): no ~2KB Android value cap for a
// multi-org `me`, and wipeAllOfflineData() already clears sync_meta on
// logout/org-switch — the exact lifecycle we want, for free.
const CACHED_ME_KEY = 'auth.me';

export async function readCachedMe(): Promise<AuthMeResponse | null> {
  try {
    const raw = await getMeta(CACHED_ME_KEY);
    if (raw === null) return null;
    const parsed = AuthMeResponseSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeCachedMe(me: AuthMeResponse): Promise<void> {
  try {
    await setMeta(CACHED_ME_KEY, JSON.stringify(me));
  } catch {
    // Best-effort — a failed cache write just means the next offline launch
    // falls back to the online-spinner / best-effort path. Never fatal.
  }
}
