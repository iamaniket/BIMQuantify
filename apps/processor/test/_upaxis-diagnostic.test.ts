/**
 * TEMPORARY diagnostic (delete before commit). Runs the real up-axis resolver
 * over every committed IFC fixture and prints the detection internals so we can
 * confirm the layered resolver picks a sane up-axis on real models.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scanModelGeometry } from '../src/pipeline/floorplans.js';
import { getIfcApi, openModel, closeModel } from '../src/pipeline/ifc.js';
import { buildMetadata } from '../src/pipeline/metadata.js';

const FIXTURES = ['Duplex.ifc', 'IfcOpenHouse2x3.ifc', 'IfcOpenHouse4.ifc'];

const fixturePath = (name: string): string =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/ifc', name);

// Point this at any IFC to diagnose it: UPAXIS_IFC="C:/path/to/model.ifc" npx vitest run _upaxis-diagnostic
const EXTRA = process.env.UPAXIS_IFC ? [process.env.UPAXIS_IFC] : [];

describe('up-axis diagnostic over real fixtures', () => {
  for (const name of [...FIXTURES, ...EXTRA]) {
    const file = EXTRA.includes(name) ? name : fixturePath(name);
    it(
      `scans ${name}`,
      async () => {
        const bytes = new Uint8Array(await readFile(file));
        const { modelID, schema } = await openModel(bytes);
        try {
          const api = await getIfcApi();
          const metadata = await buildMetadata(api, modelID, schema, undefined, false);
          const diagLogger = {
            info: (o: unknown, m: string) => console.log(`[scan] ${m}`, JSON.stringify(o)),
            warn: () => undefined,
            error: () => undefined,
            debug: () => undefined,
          } as unknown as Parameters<typeof scanModelGeometry>[4];
          const scan = scanModelGeometry(
            api,
            modelID,
            metadata.project.lengthUnit,
            metadata.elements,
            diagLogger,
          );
          // eslint-disable-next-line no-console
          console.log(
            `\n[UPAXIS] ${name}\n` +
              `  lengthUnit   = ${metadata.project.lengthUnit}\n` +
              `  upAxis       = ${['x', 'y', 'z'][scan.upAxis]} (${scan.upAxis})\n` +
              `  planAxes     = [${scan.planAxisX}, ${scan.planAxisY}]\n` +
              `  storeys      = ${scan.storeys.length}  elevations=${JSON.stringify(
                scan.storeys.map((s) => Number(s.elevation.toFixed(2))),
              )}\n` +
              `  bbox.min     = ${JSON.stringify(scan.bbox?.min.map((v) => Number(v.toFixed(2))))}\n` +
              `  bbox.max     = ${JSON.stringify(scan.bbox?.max.map((v) => Number(v.toFixed(2))))}\n` +
              `  elementCount = ${metadata.elements.length}`,
          );
          expect(scan.upAxis).toBeGreaterThanOrEqual(0);
        } finally {
          await closeModel(modelID);
        }
      },
      120_000,
    );
  }
});
