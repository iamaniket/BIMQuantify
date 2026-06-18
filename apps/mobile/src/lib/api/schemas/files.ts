import { z } from 'zod';

// Focused mobile copy of the portal ProjectFile — enough to pick the latest
// ready file for a model and label it. status is a plain string ('pending' |
// 'ready' | 'rejected'); we only branch on === 'ready'.
export const ProjectFileSchema = z.object({
  id: z.string(),
  model_id: z.string(),
  version_number: z.number().int(),
  original_filename: z.string(),
  file_type: z.string(),
  status: z.string(),
});

export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const ProjectFileListSchema = z.array(ProjectFileSchema);
export type ProjectFileList = z.infer<typeof ProjectFileListSchema>;

// Drift-resistant subset of the portal's ViewerBundleResponse — only the IFC
// artifact URLs the embedded viewer needs (incl. floor_plans_url for the 2D /
// Split views). Zod strips the fields mobile doesn't use (geometry_url,
// file_url). URLs are plain strings (not `.url()`) so an unexpected server value
// can't blank the whole response.
export const ViewerBundleResponseSchema = z.object({
  file_type: z.string(),
  fragments_url: z.union([z.string(), z.null()]),
  fragments_key: z.union([z.string(), z.null()]),
  metadata_url: z.union([z.string(), z.null()]),
  properties_url: z.union([z.string(), z.null()]),
  outline_url: z.union([z.string(), z.null()]),
  floor_plans_url: z.union([z.string(), z.null()]),
  expires_in: z.number().int().positive(),
});

export type ViewerBundleResponse = z.infer<typeof ViewerBundleResponseSchema>;
