import { z } from 'zod';

// Mirrors apps/api schemas/attachment.py. The mobile app only consumes a subset
// of AttachmentRead, but the request shapes (capture metadata, exif, geo) match
// the server so a photo logged on a phone round-trips its EXIF/GPS.

export type GeolocationData = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  altitude_accuracy?: number | null;
  low_accuracy?: boolean;
};

export type ExifData = {
  make?: string | null;
  model?: string | null;
  date_time_original?: string | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  orientation?: number | null;
  image_width?: number | null;
  image_height?: number | null;
  focal_length?: number | null;
  f_number?: number | null;
  iso?: number | null;
  exposure_time?: string | null;
  flash?: boolean | null;
  software?: string | null;
};

export type CaptureMetadataInput = {
  captured_at?: string | null;
  // Must match the server's pattern ^(camera|file_picker|drag_drop)$.
  capture_method?: 'camera' | 'file_picker' | 'drag_drop' | null;
  device?: Record<string, unknown> | null;
  geolocation?: GeolocationData | null;
  exif?: ExifData | null;
};

export type AttachmentInitiateRequest = {
  filename: string;
  size_bytes: number;
  content_type: string;
  content_sha256: string;
  description?: string | null;
  capture_metadata?: CaptureMetadataInput | null;
};

export const AttachmentInitiateResponseSchema = z.object({
  attachment_id: z.string().uuid(),
  upload_url: z.string(),
  storage_key: z.string(),
  expires_in: z.number(),
});
export type AttachmentInitiateResponse = z.infer<typeof AttachmentInitiateResponseSchema>;

export const AttachmentReadSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  original_filename: z.string(),
  size_bytes: z.number(),
  content_type: z.string(),
  attachment_category: z.union([z.string(), z.null()]),
  status: z.string(),
  description: z.union([z.string(), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AttachmentRead = z.infer<typeof AttachmentReadSchema>;

export const AttachmentDownloadResponseSchema = z.object({
  download_url: z.string(),
  expires_in: z.number(),
});
export type AttachmentDownloadResponse = z.infer<typeof AttachmentDownloadResponseSchema>;
