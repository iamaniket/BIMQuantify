// Regenerates the mobile app-icon + favicon assets from the master logo.
//
// NOTE: the *in-app* brand logo (the shared <BrandMark>) no longer comes from here — it is a
// real file synced by scripts/sync-brand-assets.mjs from assets/logos/brand-{primary,white}.png.
// This script now only produces the native app icons / splash / favicon, which are a separate,
// not-yet-rebranded pipeline still keyed off the old mark.
//
// Source (committed, transparent):
//   assets/logos/logo.png   -> the full-colour 3D "A"-folder brand logo ("the one")
//
// Outputs:
//   apps/mobile/assets/images/icon.png              1024² logo on opaque WHITE tile (iOS + fallback)
//   apps/mobile/assets/images/favicon.png           48²   logo on white (mobile web)
//   apps/mobile/assets/images/android-icon-foreground.png  512² logo, transparent (adaptive fg)
//   apps/mobile/assets/images/android-icon-background.png  512² solid WHITE (adaptive bg)
//   apps/mobile/assets/images/android-icon-monochrome.png  432² white silhouette, transparent
//   apps/mobile/assets/images/splash-icon.png       512² logo, transparent
//   apps/mobile/assets/images/logo.png              512² logo, transparent (in-app RN <Image>)
//
// This is the brand LOGO pipeline. The browser-tab FAVICONs are a separate "building"
// mark with its own source art + generator — see scripts/generate-favicons.mjs.
//
// Run from anywhere: `node scripts/generate-logo-assets.mjs`
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(scriptDir, '..'); // repo root

// sharp is a transitive dep of next (not hoisted); resolve it from the pnpm store.
let sharp;
try {
  sharp = require('sharp');
} catch {
  const { readdirSync } = require('node:fs');
  const pnpmDir = resolve(ROOT, 'node_modules/.pnpm');
  const entry = readdirSync(pnpmDir).find((d) => d.startsWith('sharp@'));
  if (!entry) throw new Error('sharp not found in node_modules/.pnpm');
  sharp = require(resolve(pnpmDir, entry, 'node_modules/sharp'));
}

const SRC = resolve(ROOT, 'assets/logos/logo.png');
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

// Tight-cropped master (transparent margins removed) so all scaling is relative to the
// actual artwork, not the source canvas's empty border.
let TRIMMED;

// `frac` of the box, centered on `bg`. Preserves aspect (contain).
async function fit(box, frac, bg) {
  const inner = Math.max(1, Math.round(box * frac));
  const fitted = await sharp(TRIMMED)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
  return sharp({ create: { width: box, height: box, channels: 4, background: bg } })
    .composite([{ input: fitted, gravity: 'center' }])
    .png();
}

// A pure-white silhouette (RGB forced white, alpha = artwork coverage) on a transparent
// canvas — the Android Material-You monochrome layer the system tints.
async function silhouette(box, frac) {
  const inner = Math.max(1, Math.round(box * frac));
  const fitted = await sharp(TRIMMED)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .ensureAlpha()
    .png()
    .toBuffer();
  const alpha = await sharp(fitted).extractChannel(3).toColourspace('b-w').toBuffer();
  const white = await sharp({ create: { width: inner, height: inner, channels: 3, background: WHITE } })
    .png()
    .toBuffer();
  const whiteAlpha = await sharp(white).joinChannel(alpha).png().toBuffer();
  return sharp({ create: { width: box, height: box, channels: 4, background: TRANSPARENT } })
    .composite([{ input: whiteAlpha, gravity: 'center' }])
    .png();
}

async function writePng(rel, png) {
  const path = resolve(ROOT, rel);
  await mkdir(dirname(path), { recursive: true });
  await png.toFile(path);
  console.log('  png  ' + rel);
}

async function main() {
  TRIMMED = await sharp(SRC).trim({ threshold: 10 }).png().toBuffer();

  // Mobile app icons (white tile per the brand decision).
  await writePng('apps/mobile/assets/images/icon.png', await fit(1024, 0.82, WHITE));
  await writePng('apps/mobile/assets/images/favicon.png', await fit(48, 0.82, WHITE));
  await writePng('apps/mobile/assets/images/android-icon-foreground.png', await fit(512, 0.66, TRANSPARENT));
  await writePng(
    'apps/mobile/assets/images/android-icon-background.png',
    sharp({ create: { width: 512, height: 512, channels: 4, background: WHITE } }).png(),
  );
  await writePng('apps/mobile/assets/images/android-icon-monochrome.png', await silhouette(432, 0.66));
  await writePng('apps/mobile/assets/images/splash-icon.png', await fit(512, 0.9, TRANSPARENT));
  await writePng('apps/mobile/assets/images/logo.png', await fit(512, 1.0, TRANSPARENT));

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
