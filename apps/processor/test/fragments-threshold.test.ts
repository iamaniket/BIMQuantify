/**
 * Fragment geometry threshold. The default (1) tessellates every element so
 * small furniture/fixtures stay visible + clickable in the viewer; a higher
 * threshold drops them. These tests pin the default and prove the mechanism, so
 * a future default change that silently strips small elements is caught.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SingleThreadedFragmentsModel } from '@thatopen/fragments';
import { describe, expect, it } from 'vitest';

import { getConfig, resetConfig } from '../src/config.js';
import { generateFragments } from '../src/pipeline/fragments.js';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../assets/ifc/IfcOpenHouse4.ifc',
);

async function renderableElementCount(frag: Uint8Array): Promise<number> {
  const model = new SingleThreadedFragmentsModel('thr', frag.slice());
  try {
    return (await model.getLocalIds()).length;
  } finally {
    // Mandatory — the model's MeshConnection starts a setInterval otherwise.
    model.dispose();
  }
}

describe('generateFragments geometry threshold', () => {
  it('defaults JOB_GEOMETRY_THRESHOLD to 1 (tessellate everything)', () => {
    resetConfig();
    expect(getConfig().JOB_GEOMETRY_THRESHOLD).toBe(1);
  });

  it('a lower threshold keeps at least as many elements renderable as a high one', async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE));
    const atOne = await renderableElementCount(await generateFragments(bytes, 1));
    const atHigh = await renderableElementCount(await generateFragments(bytes, 3000));

    expect(atOne).toBeGreaterThan(0);
    // threshold=1 tessellates small elements a high threshold would skip, so it
    // can only ever yield more (or equal) renderable elements — never fewer.
    expect(atOne).toBeGreaterThanOrEqual(atHigh);
    // eslint-disable-next-line no-console
    console.log(`[geometry threshold] renderable elements: t=1 → ${atOne}, t=3000 → ${atHigh}`);
  }, 60_000);
});
