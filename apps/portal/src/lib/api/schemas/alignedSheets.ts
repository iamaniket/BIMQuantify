import { z } from 'zod';

/** A 2D control point (x, y) in either PDF or plan space. */
export const AlignedSheetPointSchema = z.tuple([z.number(), z.number()]);

/** Raw control-point picks persisted on a calibrated sheet (audit / re-solve). */
export const AlignedSheetControlPointsSchema = z.object({
  pdf: z.array(AlignedSheetPointSchema),
  plan: z.array(AlignedSheetPointSchema),
});

export type AlignedSheetControlPoints = z.infer<typeof AlignedSheetControlPointsSchema>;

export const AlignedSheetSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  // The 3D document (supplies world coords to calibrate against).
  document_id: z.string().uuid(),
  // The project Level (shared 2D/3D spine) this sheet pins to.
  level_id: z.string().uuid(),
  // The PDF document (primary_file_type = 'pdf') whose page is aligned.
  pdf_document_id: z.string().uuid(),
  calibrated_pdf_file_id: z.string().uuid().nullable(),
  // Logical page reference + its 1-indexed number; page_index (0-based) is kept
  // for back-compat and derived from the page (page_number - 1). `page_id` is the
  // paid pdf_pages FK; the free tier references pages by number only, so it's
  // null there (the UI keys off page_index, never page_id).
  page_id: z.string().uuid().nullable(),
  page_number: z.number().int(),
  page_index: z.number().int(),
  transform_type: z.string(),
  // Solved similarity transform — null until the sheet is calibrated.
  scale: z.number().nullable(),
  rotation_rad: z.number().nullable(),
  offset_x: z.number().nullable(),
  offset_y: z.number().nullable(),
  control_points: AlignedSheetControlPointsSchema.nullable(),
  is_calibrated: z.boolean(),
  // True when the calibration was solved on a PDF version that is no longer the
  // document head (drift).
  is_stale: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AlignedSheet = z.infer<typeof AlignedSheetSchema>;

export const AlignedSheetListSchema = z.array(AlignedSheetSchema);

export type AlignedSheetList = z.infer<typeof AlignedSheetListSchema>;

export const AlignedSheetCreateSchema = z.object({
  document_id: z.string().uuid(),
  level_id: z.string().uuid(),
  pdf_document_id: z.string().uuid(),
  page_index: z.number().int().min(0).optional(),
});

export type AlignedSheetCreateInput = z.infer<typeof AlignedSheetCreateSchema>;

export const AlignedSheetUpdateSchema = z.object({
  level_id: z.string().uuid().optional(),
  page_index: z.number().int().min(0).optional(),
});

export type AlignedSheetUpdateInput = z.infer<typeof AlignedSheetUpdateSchema>;

export const CalibrateAlignedSheetSchema = z.object({
  // Exactly two matching control points on each side.
  pdf_points: z.array(AlignedSheetPointSchema).length(2),
  plan_points: z.array(AlignedSheetPointSchema).length(2),
  pdf_file_id: z.string().uuid().optional(),
});

export type CalibrateAlignedSheetInput = z.infer<typeof CalibrateAlignedSheetSchema>;
