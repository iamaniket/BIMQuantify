# mobile

Native iOS+Android field app (Expo SDK 56 / expo-router). Scope: **login → project list → open project → open document → view/add findings on the document**. Everything is native except the 3D model render, which is a WebView hosting the `apps/viewer-embed` bundle.

## Dev

```bash
pnpm --filter=mobile start          # Metro + Expo dev tools
pnpm --filter=mobile type-check     # tsc --noEmit
```

Config is via `EXPO_PUBLIC_*` env vars (inlined at build time, validated in `src/lib/env.ts`):

- `EXPO_PUBLIC_API_URL` — the API. On a physical device use your dev machine's **LAN IP** (`localhost` from a phone is the phone). The dev API binds `0.0.0.0` so the LAN can reach it.
- `EXPO_PUBLIC_VIEWER_EMBED_URL` — optional. A served build of `apps/viewer-embed` for the 3D viewer (dev/preview, and currently the only path on iOS). When unset, Android loads the in-app bundle (below) and iOS shows a "not configured" notice.
- `EXPO_PUBLIC_ENABLE_3D_VIEWER` — **experimental, off by default (not in v1).** `true` shows the in-viewer 3D/2D switcher and drives the embed's 3D pane over the bridge. MUST be paired with a 3D-capable embed build (`VITE_ENABLE_3D=true`, see [Enabling the 3D viewer](#enabling-the-3d-viewer-experimental-not-in-v1)); against a default 2D-only embed it silently stays 2D. Any value other than `true`/`1` is off.

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

### Enabling the 3D viewer (experimental, not in v1)

The mobile viewer is **2D-only by default**. The 3D pane is gated at two layers that must be set **together** — one is a hard build-time kill-switch, the other the runtime opt-in:

| Layer | Flag | Where | Effect |
|---|---|---|---|
| Build (embed) | `VITE_ENABLE_3D=true` | env when building `apps/viewer-embed` | Compiles the 3D `IfcViewer` pane in. Off ⇒ a build can never mount 3D. (Not a size lever — the 2D viewer is itself three/web-ifc-based, so those deps ship either way.) |
| Runtime (native) | `EXPO_PUBLIC_ENABLE_3D_VIEWER=true` | the mobile app build | Shows the 3D/2D switcher and requests the 3D layout over the bridge. |

A 3D-capable embed with the native flag **off** still renders 2D-only; the native flag **on** against a default (2D-only) embed also stays 2D. You need both.

For a dev device against a served embed:

```bash
# 1. serve a 3D-capable embed, LAN-reachable
VITE_ENABLE_3D=true pnpm --filter=viewer-embed build
pnpm --filter=viewer-embed dev        # vite on :5173 — bind/host it on your LAN IP

# 2. run the app pointing at it, with the native flag on
EXPO_PUBLIC_ENABLE_3D_VIEWER=true \
EXPO_PUBLIC_VIEWER_EMBED_URL=http://<LAN-IP>:5173 \
pnpm --filter=mobile start
```

For an in-app (offline) build, set both flags in an EAS profile (e.g. `preview-3d`); the `eas-build-post-install` hook builds the embed, so pass `VITE_ENABLE_3D` there.

> **Heads-up (Phase 0 spike):** running the Fragments 3D renderer inside `react-native-webview` is unverified — Worker / `SharedArrayBuffer` / IndexedDB availability needs a device check before relying on it. See the plan.

## Build (EAS)

```bash
eas login
eas build -p android --profile preview      # → APK (internal distribution)
```

A standalone APK bakes `EXPO_PUBLIC_API_URL` at build time — set it in the `preview` profile `env` (`eas.json`) to a host the device can reach.
