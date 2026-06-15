# mobile

Native iOS+Android field app (Expo SDK 56 / expo-router). Scope: **login → project list → open project → open model → view/add findings on the model**. Everything is native except the 3D model render, which is a WebView hosting the `apps/viewer-embed` bundle.

## Dev

```bash
pnpm --filter=mobile start          # Metro + Expo dev tools
pnpm --filter=mobile type-check     # tsc --noEmit
```

Config is via `EXPO_PUBLIC_*` env vars (inlined at build time, validated in `src/lib/env.ts`):

- `EXPO_PUBLIC_API_URL` — the API. On a physical device use your dev machine's **LAN IP** (`localhost` from a phone is the phone). The dev API binds `0.0.0.0` so the LAN can reach it.
- `EXPO_PUBLIC_VIEWER_EMBED_URL` — optional. A served build of `apps/viewer-embed` for the 3D viewer (dev/preview, and currently the only path on iOS). When unset, Android loads the in-app bundle (below) and iOS shows a "not configured" notice.

## Embedded 3D viewer

The viewer WebView (`src/app/viewer/.../[fileId].tsx`) loads `apps/viewer-embed`. Source precedence is in `src/features/viewer/embedSource.ts`:

1. `EXPO_PUBLIC_VIEWER_EMBED_URL` if set (dev/preview, iOS).
2. Android: the bundle shipped **in-app**, loaded from `file:///android_asset/viewer-embed/index.html` — no server, works offline.
3. Otherwise: a "not configured" notice.

**In-app bundling** is wired by the `./plugins/withViewerEmbed.js` config plugin (registered in `app.json`), which copies `apps/viewer-embed/dist` into `android/app/src/main/assets/viewer-embed/` during `expo prebuild`.

`dist/` is gitignored, so it isn't in a fresh checkout (including EAS Build, which excludes git-ignored files). The plugin **builds it on demand** during prebuild when it's missing, so you don't normally need to build it by hand — and the `eas-build-post-install` hook (`package.json`) builds it earlier when EAS runs it. To build it yourself:

```bash
pnpm --filter=viewer-embed build    # → apps/viewer-embed/dist
```

> iOS in-app bundling is a follow-up (Xcode resource folder reference + main-bundle path resolver). Until then, use `EXPO_PUBLIC_VIEWER_EMBED_URL` on iOS.
>
> The embed fetches presigned MinIO URLs cross-origin from a `file://` origin — the bucket CORS must allow it (see `apps/api/.../storage/minio.py`).

## Build (EAS)

```bash
eas login
eas build -p android --profile preview      # → APK (internal distribution)
```

A standalone APK bakes `EXPO_PUBLIC_API_URL` at build time — set it in the `preview` profile `env` (`eas.json`) to a host the device can reach.
