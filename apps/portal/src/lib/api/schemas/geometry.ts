import { z } from 'zod';

/**
 * Zod mirror of the processor's compact PDF vector-geometry artifact
 * (`apps/processor/src/pipeline/pdf-geometry.ts`). Coordinates are PDF points,
 * Y-up, bottom-left origin, box-relative (the box offset x0,y0 is already
 * subtracted away; `w`/`h` are the page-box dims in points).
 */

/** `[sx, sy, ex, ey]` or `[sx, sy, ex, ey, strokeWidth]` (page points). */
export const LineSchema = z.union([
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
]);

export type Line = z.infer<typeof LineSchema>;

export const TextEntrySchema = z.object({
  s: z.string(),
  p: z.tuple([z.number(), z.number()]),
  z: z.number(),
  r: z.number().optional(),
});

export type TextEntry = z.infer<typeof TextEntrySchema>;

export const PageGeometrySchema = z.object({
  i: z.number().int().nonnegative(),
  w: z.number(),
  h: z.number(),
  rot: z.number().optional(),
  l: z.array(LineSchema),
  t: z.array(TextEntrySchema),
  /** DXF only: layer-name table; PDF artifacts omit it. */
  lyr: z.array(z.string()).optional(),
  /** DXF only: layer index (into `lyr`) per line in `l`. */
  ll: z.array(z.number().int().nonnegative()).optional(),
  /** DXF only: layer index (into `lyr`) per text entry in `t`. */
  tl: z.array(z.number().int().nonnegative()).optional(),
});

export type PageGeometry = z.infer<typeof PageGeometrySchema>;

export const GeometryArtifactSchema = z.object({
  v: z.literal(1),
  p: z.array(PageGeometrySchema),
});

export type GeometryArtifact = z.infer<typeof GeometryArtifactSchema>;

/**
 * Zod mirror of the processor's DXF/DWG drawing-metadata blob
 * (`apps/processor/src/pipeline/dxf-geometry.ts::DrawingMetadata`). Surfaced in
 * the drawing viewer's info panel.
 */
export const DrawingLayerMetaSchema = z.object({
  name: z.string(),
  color: z.number(),
  linetype: z.string(),
  off: z.boolean(),
  frozen: z.boolean(),
  count: z.number().int().nonnegative(),
});

export type DrawingLayerMeta = z.infer<typeof DrawingLayerMetaSchema>;

export const DrawingMetadataSchema = z.object({
  source: z.enum(['dxf', 'dwg']),
  cadVersion: z.union([z.string(), z.null()]),
  units: z.string(),
  unitsCode: z.union([z.number(), z.null()]),
  extents: z.union([
    z.object({
      min: z.tuple([z.number(), z.number()]),
      max: z.tuple([z.number(), z.number()]),
    }),
    z.null(),
  ]),
  createdAt: z.union([z.string(), z.null()]),
  modifiedAt: z.union([z.string(), z.null()]),
  savedBy: z.union([z.string(), z.null()]),
  layers: z.array(DrawingLayerMetaSchema),
  entityCounts: z.record(z.string(), z.number()),
});

export type DrawingMetadata = z.infer<typeof DrawingMetadataSchema>;
