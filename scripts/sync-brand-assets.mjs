// Fans the canonical in-app brand logos out to every app that renders them.
//
// Single source of truth (committed, transparent PNG):
//   assets/logos/brand-primary.png   -> the blue "A-house" mark (default, on light backgrounds)
//   assets/logos/brand-white.png     -> the white mark (used when the background is primary blue)
//
// Destinations (plain copies — no resizing, so swapping a master is instant):
//   apps/web/public/brand/            gitignored, repopulated by web predev/prebuild
//   apps/portal/public/brand/         gitignored, repopulated by portal predev/prebuild
//   apps/mobile/assets/images/        committed (Metro/EAS bundle real files at build time)
//
// To swap a logo: replace the master PNG in assets/logos/ and re-run this script
// (`node scripts/sync-brand-assets.mjs`). Web/portal also re-run it automatically on dev/build.
//
// This is the *in-app* logo pipeline. Browser favicons and native app icons/splash are a
// separate, not-yet-rebranded pipeline (scripts/generate-logo-assets.mjs).
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(scriptDir, '..'); // repo root

const MASTERS = ['brand-primary.png', 'brand-white.png'];

// Each consuming app's directory that must receive the masters.
const DEST_DIRS = [
  'apps/web/public/brand',
  'apps/portal/public/brand',
  'apps/mobile/assets/images',
];

async function main() {
  for (const destDir of DEST_DIRS) {
    const absDir = resolve(ROOT, destDir);
    await mkdir(absDir, { recursive: true });
    for (const file of MASTERS) {
      const src = resolve(ROOT, 'assets/logos', file);
      const dst = resolve(absDir, file);
      await copyFile(src, dst);
      console.log('  copy ' + destDir + '/' + file);
    }
  }
  console.log('Brand assets synced.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
