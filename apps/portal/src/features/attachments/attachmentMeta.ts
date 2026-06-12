import type { Attachment } from '@/lib/api/schemas';
import type { Locale } from '@bimstitch/i18n';
import { formatDateTime } from '@/lib/formatting/dates';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateFull(iso: string, locale: Locale): string {
  return formatDateTime(iso, locale, iso);
}

export function formatCoord(lat: number, lon: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}° ${latDir}, ${Math.abs(lon).toFixed(6)}° ${lonDir}`;
}

export type GpsData = { latitude: number; longitude: number; altitude: number | null };
export type CameraData = { make: string | null; model: string | null };
export type ImageDims = { width: number | null; height: number | null };

export type ExifMeta = {
  gps: GpsData | null;
  camera: CameraData | null;
  dims: ImageDims | null;
  capturedAt: string | null;
};

export function extractExifMeta(att: Attachment): ExifMeta {
  const sm = att.server_metadata;
  const cm = att.capture_metadata;

  let gps: GpsData | null = null;
  let camera: CameraData | null = null;
  let dims: ImageDims | null = null;
  let capturedAt: string | null = null;

  if (sm != null) {
    const g = sm['gps'] as Record<string, unknown> | null | undefined;
    if (g != null && typeof g['latitude'] === 'number' && typeof g['longitude'] === 'number') {
      gps = {
        latitude: g['latitude'],
        longitude: g['longitude'],
        altitude: typeof g['altitude'] === 'number' ? g['altitude'] : null,
      };
    }
    const c = sm['camera'] as Record<string, unknown> | null | undefined;
    if (c != null) {
      const make = typeof c['make'] === 'string' ? c['make'] : null;
      const model = typeof c['model'] === 'string' ? c['model'] : null;
      if (make !== null || model !== null) camera = { make, model };
    }
    const img = sm['image'] as Record<string, unknown> | null | undefined;
    if (img != null) {
      const w = typeof img['width'] === 'number' ? img['width'] : null;
      const h = typeof img['height'] === 'number' ? img['height'] : null;
      if (w !== null || h !== null) dims = { width: w, height: h };
    }
    const cap = sm['capture'] as Record<string, unknown> | null | undefined;
    if (cap != null && typeof cap['date_time_original'] === 'string') {
      capturedAt = cap['date_time_original'];
    }
  } else if (cm != null) {
    const exif = cm['exif'] as Record<string, unknown> | null | undefined;
    const geo = cm['geolocation'] as Record<string, unknown> | null | undefined;
    if (geo != null && typeof geo['latitude'] === 'number' && typeof geo['longitude'] === 'number') {
      gps = {
        latitude: geo['latitude'],
        longitude: geo['longitude'],
        altitude: typeof geo['altitude'] === 'number' ? geo['altitude'] : null,
      };
    }
    if (exif != null) {
      const make = typeof exif['make'] === 'string' ? exif['make'] : null;
      const model = typeof exif['model'] === 'string' ? exif['model'] : null;
      if (make !== null || model !== null) camera = { make, model };
      const w = typeof exif['image_width'] === 'number' ? exif['image_width'] : null;
      const h = typeof exif['image_height'] === 'number' ? exif['image_height'] : null;
      if (w !== null || h !== null) dims = { width: w, height: h };
      if (typeof exif['date_time_original'] === 'string') {
        capturedAt = exif['date_time_original'];
      }
    }
  }

  return {
    gps, camera, dims, capturedAt,
  };
}

/** Human-readable "W × H" when both dimensions are known, else null. */
export function formatDims(dims: ImageDims | null): string | null {
  if (dims === null) return null;
  const { width: w, height: h } = dims;
  if (w === null || h === null) return null;
  return `${String(w)} × ${String(h)}`;
}

/** "Make Model" from camera data, else null. */
export function formatCamera(camera: CameraData | null): string | null {
  if (camera === null) return null;
  const parts = [camera.make, camera.model].filter((s): s is string => s !== null);
  return parts.length > 0 ? parts.join(' ') : null;
}
