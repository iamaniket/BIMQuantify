/**
 * End-to-end extraction over the real IfcOpenHouse4 fixture. S3 and the API
 * callback are mocked (they run on the main thread); the two extraction
 * worker threads are REAL — this exercises the tsx boot shim, the transfer
 * protocol, the fragments + outline pipeline, and the metadata/properties
 * walk on actual web-ifc/fragments code.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { postCallback } from '../src/api/callback.js';
import { runExtraction } from '../src/pipeline/extract.js';
import { decodeFloorPlans } from '../src/pipeline/floorplans.js';
import { decodeOutline } from '../src/pipeline/outline.js';
import { downloadObjectWithHash, uploadObject } from '../src/storage/s3.js';

vi.mock('../src/storage/s3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/storage/s3.js')>();
  return {
    ...actual,
    downloadObjectWithHash: vi.fn(),
    uploadObject: vi.fn(async () => undefined),
  };
});

vi.mock('../src/api/callback.js', () => ({
  postCallback: vi.fn(async () => undefined),
}));

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../assets/ifc/IfcOpenHouse4.ifc',
);

describe('runExtraction (real worker threads)', () => {
  beforeEach(() => {
    vi.mocked(postCallback).mockClear();
    vi.mocked(uploadObject).mockClear();
  });

  it(
    'extracts fragments, metadata, properties, outline and floor-plan artifacts end-to-end',
    async () => {
      const raw = await readFile(FIXTURE);
      const bytes = new Uint8Array(raw);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      vi.mocked(downloadObjectWithHash).mockResolvedValue({ bytes, sha256 });

      await runExtraction({
        job_id: 'job-1',
        job_type: 'ifc_extraction',
        organization_id: 'org-1',
        payload: {
          file_id: 'file-1',
          project_id: 'project-1',
          storage_key: 'projects/p1/IfcOpenHouse4.ifc',
          compressed: false,
        },
      });

      const callbacks = vi.mocked(postCallback).mock.calls.map(([p]) => p);
      const succeeded = callbacks.find((p) => p.status === 'succeeded');
      expect(succeeded).toBeDefined();
      expect(succeeded?.fragments_key).toBe('projects/p1/IfcOpenHouse4.frag');
      expect(succeeded?.metadata_key).toBe('projects/p1/IfcOpenHouse4.metadata.json');
      expect(succeeded?.properties_key).toBe('projects/p1/IfcOpenHouse4.properties.json');
      expect(succeeded?.outline_key).toBe('projects/p1/IfcOpenHouse4.outline.bin');
      expect(succeeded?.floor_plans_key).toBe('projects/p1/IfcOpenHouse4.floorplans.bin');
      // A house carries architectural content → classified as a plan-generating
      // kind (architectural, or mixed when it also has notable framing), so the
      // floor-plan cut is generated (gate in extraction-worker.ts::runWalk).
      expect(['architectural', 'mixed']).toContain(succeeded?.detected_kind);
      expect(succeeded?.content_sha256).toBe(sha256);
      expect(succeeded?.ifc_project_guid).toBeTruthy();

      const uploads = new Map(
        vi.mocked(uploadObject).mock.calls.map(([key, body]) => [key, body]),
      );
      expect([...uploads.keys()].sort()).toEqual([
        'projects/p1/IfcOpenHouse4.floorplans.bin',
        'projects/p1/IfcOpenHouse4.frag',
        'projects/p1/IfcOpenHouse4.metadata.json',
        'projects/p1/IfcOpenHouse4.outline.bin',
        'projects/p1/IfcOpenHouse4.properties.json',
      ]);

      const fragBytes = uploads.get('projects/p1/IfcOpenHouse4.frag');
      expect(fragBytes).toBeInstanceOf(Uint8Array);
      expect((fragBytes as Uint8Array).length).toBeGreaterThan(0);

      // The uploaded outline must decode (magic + length checks live inside
      // decodeOutline) and satisfy the format-v2 invariants.
      const outlineBytes = uploads.get('projects/p1/IfcOpenHouse4.outline.bin');
      expect(outlineBytes).toBeInstanceOf(Uint8Array);
      const outline = decodeOutline(outlineBytes as Uint8Array);
      expect(outline.templateCount).toBeGreaterThan(0);
      expect(outline.instanceCount).toBeGreaterThan(0);
      // Every template is referenced by ≥1 instance, so templates never
      // outnumber instances; real buildings reuse shapes, shrinking the file.
      expect(outline.templateCount).toBeLessThanOrEqual(outline.instanceCount);
      expect(outline.templates).toHaveLength(outline.templateCount);
      let floatSum = 0;
      for (const tmpl of outline.templates) {
        // Segments are 6 floats; edge-less templates are never emitted.
        expect(tmpl.length % 6).toBe(0);
        expect(tmpl.length).toBeGreaterThan(0);
        expect(tmpl.every((v) => Number.isFinite(v))).toBe(true);
        floatSum += tmpl.length;
      }
      expect(floatSum).toBe(outline.templateFloatsTotal);
      expect(outline.instanceLocalIds).toHaveLength(outline.instanceCount);
      expect(outline.instanceTemplateIndex).toHaveLength(outline.instanceCount);
      expect(outline.instanceTransforms).toHaveLength(outline.instanceCount * 16);
      expect(outline.instanceTransforms.every((v) => Number.isFinite(v))).toBe(true);
      // Visibility into the size win (templates ≪ instances on repetitive models).
      // eslint-disable-next-line no-console
      console.log(
        `[outline v2] templates=${outline.templateCount} instances=${outline.instanceCount} ` +
          `bytes=${(outlineBytes as Uint8Array).length}`,
      );

      // The uploaded floor-plan artifact must decode and carry ≥1 level with
      // finite world-XY cut geometry (IfcOpenHouse4 is a single storey).
      const floorPlansBytes = uploads.get('projects/p1/IfcOpenHouse4.floorplans.bin');
      expect(floorPlansBytes).toBeInstanceOf(Uint8Array);
      const floorPlans = decodeFloorPlans(floorPlansBytes as Uint8Array);
      expect(floorPlans.levels.length).toBeGreaterThan(0);
      const firstLevel = floorPlans.levels[0]!;
      expect(firstLevel.wallSegments.length % 4).toBe(0);
      expect(firstLevel.wallSegments.every((v) => Number.isFinite(v))).toBe(true);
      expect(firstLevel.wallSegments.length > 0 || firstLevel.rooms.length > 0).toBe(true);

      const metadataRaw = uploads.get('projects/p1/IfcOpenHouse4.metadata.json');
      expect(metadataRaw).toBeInstanceOf(Uint8Array);
      const metadata = JSON.parse(
        new TextDecoder().decode(metadataRaw as Uint8Array),
      ) as Record<string, unknown>;
      expect(metadata['source_format']).toBe('ifc');
      expect(metadata['schema']).toBe('IFC4');
      expect(metadata['project']).toMatchObject({ globalId: expect.any(String) });
      expect(Array.isArray(metadata['elements'])).toBe(true);
      expect((metadata['elements'] as unknown[]).length).toBeGreaterThan(0);
      expect(metadata['elementCounts']).toBeTypeOf('object');
      expect(metadata['totalElements']).toBeGreaterThan(0);
      expect(metadata['bbox']).toBeTruthy();

      const propertiesRaw = uploads.get('projects/p1/IfcOpenHouse4.properties.json');
      expect(propertiesRaw).toBeInstanceOf(Uint8Array);
      const properties = JSON.parse(
        new TextDecoder().decode(propertiesRaw as Uint8Array),
      ) as Record<string, unknown>;
      expect(Object.keys(properties).length).toBeGreaterThan(0);
    },
    120_000,
  );
});
