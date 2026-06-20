// Regenerates the marketing-site favicons from the source brand art.
//
// Source art (transparent, 2048x2048):
//   assets/logos/bd_light.png  -> blue mark, used on LIGHT-mode browser tabs
//   assets/logos/bd_dark.png   -> white mark, used on DARK-mode browser tabs
//
// Outputs (theme switching is driven by the OS `prefers-color-scheme`, which is
// what controls the browser tab/chrome appearance — see metadata.icons wiring):
//   apps/web/public/favicon.svg         both marks, toggled by in-SVG media query (Chrome/FF)
//   apps/web/public/favicon-light.png   blue  64x64  (prefers-color-scheme: light, Safari)
//   apps/web/public/favicon-dark.png    white 64x64  (prefers-color-scheme: dark, Safari)
//   apps/web/public/favicon.ico         blue  48x48  legacy fallback
//   apps/web/public/apple-icon.png      white-on-blue 180x180 tile (iOS ignores alpha)
//
// Run from anywhere: `node apps/web/scripts/generate-icons.mjs`
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, readdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(scriptDir, '../../..'); // repo root

// Resolve sharp from the pnpm store (it's a transitive dep of next, not hoisted).
function loadSharp() {
  try {
    return require('sharp');
  } catch {
    const pnpmDir = resolve(ROOT, 'node_modules/.pnpm');
    // best-effort: handled synchronously below via a known glob
    throw new Error(`sharp not directly resolvable; install or check ${pnpmDir}`);
  }
}

let sharp;
try {
  sharp = loadSharp();
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
const PUBLIC = resolve(ROOT, 'apps/web/public');

// Trim the transparent margin, then fit the mark into a square canvas with a
// little breathing room so it reads well at tiny favicon sizes.
async function squareMark(src, box, pad) {
  const inner = box - pad * 2;
  const fitted = await sharp(src)
    .trim({ threshold: 10 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: box, height: box, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: fitted, gravity: 'center' }])
    .png();
}

// Minimal ICO container wrapping a single PNG image (browsers accept PNG-in-ICO).
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // image data size
  entry.writeUInt32LE(6 + 16, 12); // offset to image data
  return Buffer.concat([header, entry, png]);
}

// Single theme-aware SVG favicon: embeds both raster marks and toggles them with an
// internal `prefers-color-scheme` media query. This is what makes the switch work in
// Chrome — Chrome ignores the `media` attribute on `<link rel="icon">` but DOES honor
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

  // 1. Theme-specific tab favicons (Safari honors the link `media` attribute) +
  //    a single theme-toggling SVG (Chrome/Firefox honor the in-SVG media query).
  const lightPng = await (await squareMark(SRC_LIGHT, 64, 4)).toBuffer();
  const darkPng = await (await squareMark(SRC_DARK, 64, 4)).toBuffer();
  await writeFile(resolve(PUBLIC, 'favicon-light.png'), lightPng);
  await writeFile(resolve(PUBLIC, 'favicon-dark.png'), darkPng);
  await writeFile(resolve(PUBLIC, 'favicon.svg'), themeSvg(lightPng, darkPng));

  // 2. Legacy fallback .ico (blue mark, visible on the common white tab).
  const icoPng = await (await squareMark(SRC_LIGHT, 48, 3)).toBuffer();
  await writeFile(resolve(PUBLIC, 'favicon.ico'), pngToIco(icoPng, 48));

  // 3. Apple touch icon: white mark on a solid blue tile (iOS flattens alpha).
  const fittedWhite = await sharp(SRC_DARK)
    .trim({ threshold: 10 })
    .resize(132, 132, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: { width: 180, height: 180, channels: 4, background: BRAND_BLUE },
  })
    .composite([{ input: fittedWhite, gravity: 'center' }])
    .png()
    .toFile(resolve(PUBLIC, 'apple-icon.png'));

  console.log('Generated:');
  for (const f of await readdir(PUBLIC)) {
    if (f.startsWith('favicon') || f === 'apple-icon.png') console.log('  apps/web/public/' + f);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
