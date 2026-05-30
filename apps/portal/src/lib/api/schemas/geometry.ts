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
});

export type PageGeometry = z.infer<typeof PageGeometrySchema>;

export const GeometryArtifactSchema = z.object({
  v: z.literal(1),
  p: z.array(PageGeometrySchema),
});

export type GeometryArtifact = z.infer<typeof GeometryArtifactSchema>;
