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
  // Base URL of the web portal (apps/portal). The login screen opens its
  // Forgot-password and Request-access pages here in the device browser — the
  // mobile app has no such screens (sign-in is invite-only). Defaults to the
  // dev portal; override with your LAN IP for a physical device (see API note).
  EXPO_PUBLIC_WEB_URL: z.string().url(),
});

// The LAN-IP defaults are dev convenience ONLY (gated behind __DEV__): a
// production build with these unset must fail at import via the Zod `.url()`
// requirement, instead of silently baking in a developer's private LAN IP.
const parsed = EnvSchema.safeParse({
  EXPO_PUBLIC_API_URL:
    process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://192.168.1.251:8000' : undefined),
  EXPO_PUBLIC_VIEWER_EMBED_URL: process.env.EXPO_PUBLIC_VIEWER_EMBED_URL,
  EXPO_PUBLIC_WEB_URL:
    process.env.EXPO_PUBLIC_WEB_URL ?? (__DEV__ ? 'http://192.168.1.251:3001' : undefined),
});

if (!parsed.success) {
  throw new Error(
    `Invalid environment variables: ${parsed.error.issues
      .map((i) => i.path.join('.'))
      .join(', ')}`,
  );
}

export const env = parsed.data;
