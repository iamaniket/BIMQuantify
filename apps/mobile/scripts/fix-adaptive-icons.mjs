// apps/mobile/scripts/fix-adaptive-icons.mjs
//
// Regenerates the Android adaptive-icon source art so the logo sits inside the
// adaptive-icon "safe zone" with transparent padding, instead of near full-bleed
// (which the circular launcher mask clips). Also flattens the iOS / legacy icon
// onto opaque white (skipped when it is already opaque).
//
// Idempotent: trim() recovers the tight logo bbox regardless of existing padding,
// so re-running (or changing SAFE_RATIO) always rescales from the real logo.
//
// Run from the repo root:  node apps/mobile/scripts/fix-adaptive-icons.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const REPO = path.resolve(import.meta.dirname, '../../..'); // scripts -> mobile -> apps -> root
const IMAGES = path.join(REPO, 'apps/mobile/assets/images');
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// Fraction of the 108dp canvas the logo's bounding box may occupy. The folder
// mark is a chunky, near-square shape that fills its bbox, so it must clear the
// circular launcher mask (≈ the 72dp inner viewport circle), not just the 72dp
// square. 0.48 keeps the whole folder inside the circle with a clean margin on
// every launcher shape while staying prominent; 0.66 (the 72dp-square rule)
// still clips the corners on a circle. Lower toward 0.44 for more safety margin.
const SAFE_RATIO = 0.48;

// sharp is not a direct dependency — it lives in the pnpm store as a transitive
// dep of @expo/image-utils. Resolve it from there (auto-discover the version).
const pnpmDir = path.join(REPO, 'node_modules/.pnpm');
const sharpDir = fs.readdirSync(pnpmDir).find((d) => /^sharp@/.test(d));
if (!sharpDir) throw new Error('sharp not found in pnpm store — run `pnpm install` first');
const sharpReq = require(path.join(pnpmDir, sharpDir, 'node_modules/sharp'));
const sharp = sharpReq.default ?? sharpReq;

// Scale a transparent logo into the centered safe zone of a same-size canvas.
async function rezone(file, canvas, ratio = SAFE_RATIO) {
  const src = path.join(IMAGES, file);
  const box = Math.round(canvas * ratio);
  let trimmed;
  try {
    trimmed = await sharp(src)
      .ensureAlpha()
      .trim({ background: TRANSPARENT, threshold: 10 })
      .png()
      .toBuffer();
  } catch {
    trimmed = await sharp(src).ensureAlpha().png().toBuffer(); // uniform image: skip trim
  }
  const layer = await sharp(trimmed)
    .resize(box, box, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
  await sharp({ create: { width: canvas, height: canvas, channels: 4, background: TRANSPARENT } })
    .composite([{ input: layer, gravity: 'center' }])
    .png()
    .toFile(src); // two-pass buffer => safe to overwrite in place
  console.log(`rezoned ${file}: ${box}px logo in ${canvas}px canvas (ratio ${ratio})`);
}

// Make the iOS / legacy icon fully opaque (no padding — iOS wants full-bleed).
// Skips rewriting when the image is already opaque, to avoid a needless re-encode diff.
async function flattenOpaque(file) {
  const src = path.join(IMAGES, file);
  const alpha = (await sharp(src).stats()).channels[3];
  if (!alpha || alpha.min === 255) {
    console.log(`skipped ${file} — already fully opaque`);
    return;
  }
  const buf = await sharp(src).flatten({ background: '#ffffff' }).png().toBuffer();
  await fs.promises.writeFile(src, buf);
  console.log(`flattened ${file} onto white (opaque)`);
}

await rezone('android-icon-foreground.png', 512);
await rezone('android-icon-monochrome.png', 432); // 432, not 512
await flattenOpaque('icon.png');
console.log('done');
