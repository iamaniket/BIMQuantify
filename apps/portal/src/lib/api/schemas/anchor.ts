import { z } from 'zod';

/**
 * The generalized anchor shared by attachments, findings and certificates.
 *
 * `linked_file_type` names what kind of source an anchor points into and is the
 * single source of truth for which flattened `anchor_*` columns are active
 * (mirrors the backend `schemas/anchor.py`):
 *   - ifc       -> anchor_x, anchor_y, anchor_z   3D world coordinates (meters)
 *   - pdf       -> anchor_page (>=1), anchor_x, anchor_y normalized 0..1
 *   - image     -> anchor_x, anchor_y             normalized 0..1
 *   - dxf / dwg -> anchor_x, anchor_y             drawing model-space units
 *
 * The geometry is stored in dedicated scalar columns (no JSONB) end-to-end, so
 * the wire payload carries `anchor_x/y/z/page` rather than a point object.
 */
export const LinkedFileTypeEnum = z.enum(['ifc', 'pdf', 'dxf', 'dwg', 'image']);
export type LinkedFileTypeValue = z.infer<typeof LinkedFileTypeEnum>;

/** Anchor fields as they appear on a read model (always present, nullable). */
export const anchorReadFields = {
  linked_file_type: z.union([LinkedFileTypeEnum, z.null()]),
  anchor_x: z.union([z.number(), z.null()]),
  anchor_y: z.union([z.number(), z.null()]),
  anchor_z: z.union([z.number(), z.null()]),
  anchor_page: z.union([z.number(), z.null()]),
} as const;

/** Anchor fields as they appear on a create/update payload (all optional). */
export const anchorWriteFields = {
  linked_file_type: z.union([LinkedFileTypeEnum, z.null()]).optional(),
  anchor_x: z.union([z.number(), z.null()]).optional(),
  anchor_y: z.union([z.number(), z.null()]).optional(),
  anchor_z: z.union([z.number(), z.null()]).optional(),
  anchor_page: z.union([z.number().int(), z.null()]).optional(),
} as const;

/** A resolved anchor ready to thread into a create/update payload. */
export type LinkedAnchor = {
  linked_file_type: LinkedFileTypeValue;
  anchor_x: number;
  anchor_y: number;
  anchor_z?: number;
  anchor_page?: number;
};

/** Build a 3D (IFC) anchor from a picked world point. */
export function anchor3d(point: { x: number; y: number; z: number }): LinkedAnchor {
  return { linked_file_type: 'ifc', anchor_x: point.x, anchor_y: point.y, anchor_z: point.z };
}

/** Build a 2D PDF anchor from a 1-based page and a normalized point. */
export function anchorPdf(page: number, x: number, y: number): LinkedAnchor {
  return { linked_file_type: 'pdf', anchor_page: page, anchor_x: x, anchor_y: y };
}

/** Build a 2D image anchor from a normalized point (0..1). */
export function anchorImage(x: number, y: number): LinkedAnchor {
  return { linked_file_type: 'image', anchor_x: x, anchor_y: y };
}

/** Build a 2D drawing anchor (DXF/DWG) from a model-space point. */
export function anchorDrawing(
  fileType: 'dxf' | 'dwg',
  x: number,
  y: number,
): LinkedAnchor {
  return { linked_file_type: fileType, anchor_x: x, anchor_y: y };
}

/** Flattened anchor payload fields (all optional — only defined axes appear). */
export type AnchorPayloadFields = Partial<{
  linked_file_type: LinkedFileTypeValue | null;
  anchor_x: number;
  anchor_y: number;
  anchor_z: number;
  anchor_page: number;
}>;

/**
 * Decompose a raw pick point (e.g. `{x,y,z}` or `{page,x,y}`) plus its file type
 * into the flat anchor payload fields. Axes absent from the point are omitted,
 * so a 2D point yields no `anchor_z`. Returns `{}` when neither is set, so the
 * spread leaves an unanchored payload untouched.
 */
export function anchorFieldsFromPoint(
  fileType: LinkedFileTypeValue | null | undefined,
  point: Record<string, number> | null | undefined,
): AnchorPayloadFields {
  if (point == null) {
    return fileType == null ? {} : { linked_file_type: fileType };
  }
  const fields: AnchorPayloadFields = { linked_file_type: fileType ?? null };
  if (point['x'] !== undefined) fields.anchor_x = point['x'];
  if (point['y'] !== undefined) fields.anchor_y = point['y'];
  if (point['z'] !== undefined) fields.anchor_z = point['z'];
  if (point['page'] !== undefined) fields.anchor_page = point['page'];
  return fields;
}
