const { withDangerousMod } = require('expo/config-plugins');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Ships apps/viewer-embed/dist inside the native app so the 3D-viewer WebView
 * loads it from the device filesystem (file://) — no dev server, works offline.
 *
 * Android: copies dist → android/app/src/main/assets/viewer-embed/. At runtime
 * the WebView loads `file:///android_asset/viewer-embed/index.html` — see
 * src/features/viewer/embedSource.ts. Vite builds the embed with `base: './'`,
 * so its asset references (`./assets/...`, `./web-ifc/...`, `./fragments/...`)
 * resolve relative to that index.html on the device.
 *
 * dist/ is gitignored, so it is ABSENT from a fresh checkout — including EAS
 * Build, which excludes git-ignored files from the uploaded project. So we build
 * it on demand here when it's missing. This dangerous mod runs during
 * `expo prebuild`, which EAS runs AFTER installing dependencies, so the embed's
 * build tooling (vite, web-ifc, @thatopen/fragments — devDeps that pnpm installs
 * regardless of NODE_ENV) is available. The `eas-build-post-install` hook in
 * apps/mobile/package.json builds it earlier when it can; this is the guarantee.
 * When dist already exists (e.g. a local `pnpm --filter=viewer-embed build`), we
 * skip the rebuild and just copy.
 *
 * iOS in-app bundling is a follow-up (needs an Xcode resource folder reference +
 * a main-bundle path resolver). Until then, set EXPO_PUBLIC_VIEWER_EMBED_URL to a
 * served build of apps/viewer-embed on iOS; the resolver falls back to it.
 *
 * This config plugin only runs during `expo prebuild` (native generation) — it
 * does not affect Metro/dev or `expo export`.
 */

const ASSET_SUBDIR = 'viewer-embed';

/** Absolute path to the apps/viewer-embed package, resolved from the mobile root. */
function embedAppDir(projectRoot) {
  return path.resolve(projectRoot, '..', 'viewer-embed');
}

/** Returns the dist dir, building the embed bundle first if it isn't there yet. */
function ensureEmbedBuilt(projectRoot) {
  const appDir = embedAppDir(projectRoot);
  const distDir = path.join(appDir, 'dist');
  const indexHtml = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtml)) return distDir;

  console.log('[withViewerEmbed] viewer-embed/dist is missing — building it…');
  try {
    // `pnpm run build` runs the package's own predefined build (copy-wasm +
    // vite build). pnpm is the project's package manager, so it's on PATH both
    // locally and on EAS.
    execSync('pnpm run build', { cwd: appDir, stdio: 'inherit' });
  } catch (err) {
    throw new Error(
      '[withViewerEmbed] Failed to build apps/viewer-embed. Build it manually before ' +
        `prebuild:  pnpm --filter=viewer-embed build\nCause: ${err.message}`,
    );
  }
  if (!fs.existsSync(indexHtml)) {
    throw new Error(
      `[withViewerEmbed] Built apps/viewer-embed but ${indexHtml} is still missing.`,
    );
  }
  return distDir;
}

const withViewerEmbedAndroid = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const distDir = ensureEmbedBuilt(cfg.modRequest.projectRoot);

      // android/app/src/main/assets/viewer-embed
      const target = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
        ASSET_SUBDIR,
      );

      // Replace wholesale so a rebuilt/renamed-hash bundle never leaves stale chunks.
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(distDir, target, { recursive: true });

      return cfg;
    },
  ]);

/** @param {import('expo/config').ExpoConfig} config */
module.exports = function withViewerEmbed(config) {
  return withViewerEmbedAndroid(config);
};
