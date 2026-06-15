import { z } from 'zod';

// Expo inlines `process.env.EXPO_PUBLIC_*` at build time. Override for a physical
// device by setting EXPO_PUBLIC_API_URL to your machine's LAN IP — `localhost`
// from a phone points at the phone itself, not your dev machine. Validated once
// at import (mirrors the portal's lib/env.ts pattern).
const EnvSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url(),
  // Where the embedded 3D viewer bundle (apps/viewer-embed) is served. Optional:
  // unset → the viewer screen shows a "not configured" notice. For a device,
  // point it at a served build of apps/viewer-embed (e.g. your LAN IP + Vite
  // preview port). Production ships the bundle in-app and loads it from file://.
  EXPO_PUBLIC_VIEWER_EMBED_URL: z.string().url().optional(),
});

const parsed = EnvSchema.safeParse({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.251:8000',
  EXPO_PUBLIC_VIEWER_EMBED_URL: process.env.EXPO_PUBLIC_VIEWER_EMBED_URL,
});

if (!parsed.success) {
  throw new Error(
    `Invalid environment variables: ${parsed.error.issues
      .map((i) => i.path.join('.'))
      .join(', ')}`,
  );
}

export const env = parsed.data;
