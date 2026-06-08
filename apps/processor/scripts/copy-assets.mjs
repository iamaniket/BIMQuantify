/**
 * Copies non-TypeScript assets (CSS, images, etc.) from src/ to dist/ so they
 * are available at runtime after `tsc` compilation. TypeScript only emits .js
 * files; static assets need explicit copying.
 */

import { cpSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const assets = [
  { src: 'src/pipeline/report/assets', dest: 'dist/pipeline/report/assets' },
];

for (const { src, dest } of assets) {
  const srcPath = resolve(root, src);
  const destPath = resolve(root, dest);
  if (existsSync(srcPath)) {
    cpSync(srcPath, destPath, { recursive: true });
    console.log(`  copied ${src} → ${dest}`);
  } else {
    console.warn(`  WARN: ${src} does not exist, skipping`);
  }
}
