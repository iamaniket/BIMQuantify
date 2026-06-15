import { Platform } from 'react-native';

import { env } from '@/lib/env';

/**
 * file:// URL of the in-app viewer-embed bundle shipped into the APK's assets by
 * the `withViewerEmbed` config plugin (apps/mobile/plugins/withViewerEmbed.js).
 * Android exposes android/app/src/main/assets/ at this virtual host.
 */
const ANDROID_BUNDLED_URI = 'file:///android_asset/viewer-embed/index.html';

export type EmbedSource = { uri: string };

/**
 * Where the viewer WebView loads the embedded 3D viewer from.
 *
 * Precedence:
 *  1. EXPO_PUBLIC_VIEWER_EMBED_URL — a served build of apps/viewer-embed. This is
 *     the dev/preview path and (for now) the only path on iOS.
 *  2. Android — the bundle shipped in-app, loaded from the device filesystem;
 *     no server, works offline.
 *  3. null — nothing available (iOS without the env override). The screen shows a
 *     "not configured" notice.
 *
 * The presigned MinIO URLs the embed then fetches still cross-origin from this
 * file:// origin, so the bucket CORS must allow it (see apps/api storage/minio.py).
 */
export function resolveEmbedSource(): EmbedSource | null {
  const override = env.EXPO_PUBLIC_VIEWER_EMBED_URL;
  if (override !== undefined) return { uri: override };
  if (Platform.OS === 'android') return { uri: ANDROID_BUNDLED_URI };
  return null;
}
