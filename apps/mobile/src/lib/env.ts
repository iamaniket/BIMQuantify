import { z } from 'zod';

// Expo inlines `process.env.EXPO_PUBLIC_*` at build time. Override for a physical
// device by setting EXPO_PUBLIC_API_URL to your machine's LAN IP — `localhost`
// from a phone points at the phone itself, not your dev machine. Validated once
// at import (mirrors the portal's lib/env.ts pattern).
const EnvSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url(),
});

const parsed = EnvSchema.safeParse({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000',
});

if (!parsed.success) {
  throw new Error(
    `Invalid environment variables: ${parsed.error.issues
      .map((i) => i.path.join('.'))
      .join(', ')}`,
  );
}

export const env = parsed.data;
