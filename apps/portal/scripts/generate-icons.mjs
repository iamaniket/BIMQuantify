// Regenerates the portal favicons from the source brand art.
//
// Source art (transparent, 2048x2048):
//   assets/logos/bd_light.png  -> blue mark, used on LIGHT-mode browser tabs
//   assets/logos/bd_dark.png   -> white mark, used on DARK-mode browser tabs
//
// Outputs (all into apps/portal/public/):
//   Tab favicon (theme-aware via metadata.icons media queries in src/app/layout.tsx):
//     favicon-light.png   blue  64x64   (prefers-color-scheme: light)
//     favicon-dark.png    white 64x64   (prefers-color-scheme: dark)
//     favicon.ico         blue  48x48   legacy fallback
//   Apple touch icon (iOS flattens alpha -> solid tile):
//     apple-icon.png      white-on-blue 180x180
//
// Run from anywhere: `node apps/portal/scripts/generate-icons.mjs`
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(scriptDir, '../../..'); // repo root

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

const BRAND_BLUE = '#2c5697';
const SRC_LIGHT = resolve(ROOT, 'assets/logos/bd_light.png'); // blue mark
const SRC_DARK = resolve(ROOT, 'assets/logos/bd_dark.png'); // white mark
const PUBLIC = resolve(ROOT, 'apps/portal/public');

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

// Trim transparent margin, fit the mark into a square canvas with breathing room.
async function squareMark(src, box, pad) {
  const inner = box - pad * 2;
  const fitted = await sharp(src)
    .trim({ threshold: 10 })
    .resize(inner, inner, { fit: 'contain', background: transparent })
    .png()
    .toBuffer();
  return sharp({ create: { width: box, height: box, channels: 4, background: transparent } })
    .composite([{ input: fitted, gravity: 'center' }])
    .png();
}

// Solid-background tile: mark centered at `fraction` of the canvas (PWA / apple).
async function tile(src, box, bg, fraction) {
  const inner = Math.round(box * fraction);
  const fitted = await sharp(src)
    .trim({ threshold: 10 })
    .resize(inner, inner, { fit: 'contain', background: transparent })
    .png()
    .toBuffer();
  return sharp({ create: { width: box, height: box, channels: 4, background: bg } })
    .composite([{ input: fitted, gravity: 'center' }])
    .png();
}

// Minimal ICO container wrapping a single PNG (browsers accept PNG-in-ICO).
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, entry, png]);
}

// Single theme-aware SVG favicon: embeds both marks, toggled by an in-SVG media query.
// Chrome ignores the `media` attribute on `<link rel="icon">` but honors
// `@media (prefers-color-scheme)` inside an SVG favicon.
function themeSvg(lightPng, darkPng) {
  const l = lightPng.toString('base64');
  const d = darkPng.toString('base64');
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="BimDossier">' +
    '<style>.d{display:none}@media(prefers-color-scheme:dark){.l{display:none}.d{display:inline}}</style>' +
    `<image class="l" width="64" height="64" href="data:image/png;base64,${l}"/>` +
    `<image class="d" width="64" height="64" href="data:image/png;base64,${d}"/>` +
    '</svg>\n'
  );
}

async function main() {
  await mkdir(PUBLIC, { recursive: true });

  // Tab favicons: theme-toggling SVG (Chrome/FF) + light/dark PNGs (Safari) + ico fallback.
  const lightPng = await (await squareMark(SRC_LIGHT, 64, 4)).toBuffer();
  const darkPng = await (await squareMark(SRC_DARK, 64, 4)).toBuffer();
  await writeFile(resolve(PUBLIC, 'favicon-light.png'), lightPng);
  await writeFile(resolve(PUBLIC, 'favicon-dark.png'), darkPng);
  await writeFile(resolve(PUBLIC, 'favicon.svg'), themeSvg(lightPng, darkPng));
  const icoPng = await (await squareMark(SRC_LIGHT, 48, 3)).toBuffer();
  await writeFile(resolve(PUBLIC, 'favicon.ico'), pngToIco(icoPng, 48));

  // Apple touch icon.
  await (await tile(SRC_DARK, 180, BRAND_BLUE, 0.73)).toFile(resolve(PUBLIC, 'apple-icon.png'));

  console.log('Generated portal icons in apps/portal/public/:');
  for (const f of [
    'favicon.svg',
    'favicon-light.png',
    'favicon-dark.png',
    'favicon.ico',
    'apple-icon.png',
  ]) {
    console.log('  ' + f);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
