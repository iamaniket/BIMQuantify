/**
 * Lazy singleton Chromium browser. Reused across compliance report jobs to
 * avoid the ~500ms launch overhead per render. Recycled every N renders so
 * leaked pages don't grow memory unbounded.
 */

import type { Browser } from 'puppeteer-core';
import { logger } from '../../log.js';

const RECYCLE_AFTER = 100;
let cached: Browser | null = null;
let renderCount = 0;

async function launch(): Promise<Browser> {
  // Imported dynamically so unit tests that don't render PDFs don't pay the
  // load cost (and don't fail when puppeteer-core isn't installed in
  // CI-without-chromium environments).
  const puppeteer = (await import('puppeteer-core')).default;
  const executablePath = process.env['PUPPETEER_EXECUTABLE_PATH'];
  if (!executablePath) {
    throw new Error(
      'PUPPETEER_EXECUTABLE_PATH not set — cannot launch Chromium for PDF rendering',
    );
  }
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });
}

export async function getBrowser(): Promise<Browser> {
  if (cached === null) {
    cached = await launch();
    renderCount = 0;
    logger.info('chromium browser launched');
  }
  return cached;
}

export async function noteRender(): Promise<void> {
  renderCount += 1;
  if (renderCount >= RECYCLE_AFTER && cached !== null) {
    logger.info({ renderCount }, 'recycling chromium browser');
    const old = cached;
    cached = null;
    renderCount = 0;
    try {
      await old.close();
    } catch (err) {
      logger.warn({ err }, 'failed to close recycled chromium');
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (cached !== null) {
    const old = cached;
    cached = null;
    try {
      await old.close();
    } catch (err) {
      logger.warn({ err }, 'failed to close chromium on shutdown');
    }
  }
}
