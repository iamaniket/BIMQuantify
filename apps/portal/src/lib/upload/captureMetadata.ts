import exifr from 'exifr';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaptureMethod = 'camera' | 'file_picker' | 'drag_drop';

export type GeolocationData = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  altitude_accuracy: number | null;
  low_accuracy: boolean;
}

export type ExifData = {
  make: string | null;
  model: string | null;
  date_time_original: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  orientation: number | null;
  image_width: number | null;
  image_height: number | null;
  focal_length: number | null;
  f_number: number | null;
  iso: number | null;
  exposure_time: string | null;
  flash: boolean | null;
  software: string | null;
}

export type CaptureMetadata = {
  captured_at: string;
  capture_method: CaptureMethod;
  device: { user_agent: string };
  geolocation: GeolocationData | null;
  exif: ExifData | null;
}

export type GeolocationResult =
  | { status: 'granted'; data: GeolocationData }
  | { status: 'denied' }
  | { status: 'unavailable' };

// ---------------------------------------------------------------------------
// EXIF extraction
// ---------------------------------------------------------------------------

const EXIF_PICK = [
  'Make', 'Model', 'DateTimeOriginal',
  'GPSLatitude', 'GPSLongitude',
  'Orientation', 'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight',
  'FocalLength', 'FNumber', 'ISO', 'ExposureTime',
  'Flash', 'Software',
] as const;

export async function extractExif(file: File): Promise<ExifData | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const raw = await exifr.parse(file, { pick: [...EXIF_PICK] });
    if (raw == null) return null;

    const width = (raw.ImageWidth as number | undefined) ?? (raw.ExifImageWidth as number | undefined) ?? null;
    const height = (raw.ImageHeight as number | undefined) ?? (raw.ExifImageHeight as number | undefined) ?? null;

    let exposureTime: string | null = null;
    if (raw.ExposureTime != null) {
      const et = raw.ExposureTime as number;
      exposureTime = et < 1 ? `1/${Math.round(1 / et)}` : String(et);
    }

    let flash: boolean | null = null;
    if (raw.Flash != null) {
      flash = typeof raw.Flash === 'boolean'
        ? raw.Flash
        : typeof raw.Flash === 'number'
          ? (raw.Flash & 1) === 1
          : null;
    }

    let dateTimeOriginal: string | null = null;
    if (raw.DateTimeOriginal != null) {
      dateTimeOriginal = raw.DateTimeOriginal instanceof Date
        ? raw.DateTimeOriginal.toISOString()
        : String(raw.DateTimeOriginal);
    }

    return {
      make: (raw.Make as string | undefined) ?? null,
      model: (raw.Model as string | undefined) ?? null,
      date_time_original: dateTimeOriginal,
      gps_latitude: (raw.GPSLatitude as number | undefined) ?? null,
      gps_longitude: (raw.GPSLongitude as number | undefined) ?? null,
      orientation: (raw.Orientation as number | undefined) ?? null,
      image_width: width,
      image_height: height,
      focal_length: (raw.FocalLength as number | undefined) ?? null,
      f_number: (raw.FNumber as number | undefined) ?? null,
      iso: (raw.ISO as number | undefined) ?? null,
      exposure_time: exposureTime,
      flash,
      software: (raw.Software as string | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------

const LOW_ACCURACY_THRESHOLD = 50;

export function requestGeolocation(): Promise<GeolocationResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ status: 'unavailable' });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          status: 'granted',
          data: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            altitude_accuracy: pos.coords.altitudeAccuracy,
            low_accuracy: pos.coords.accuracy > LOW_ACCURACY_THRESHOLD,
          },
        });
      },
      (err) => {
        resolve(
          err.code === err.PERMISSION_DENIED
            ? { status: 'denied' }
            : { status: 'unavailable' },
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

// ---------------------------------------------------------------------------
// Build metadata
// ---------------------------------------------------------------------------

export async function buildCaptureMetadata(
  file: File,
  method: CaptureMethod,
  geo: GeolocationResult,
): Promise<CaptureMetadata> {
  const exif = await extractExif(file);

  return {
    captured_at: new Date().toISOString(),
    capture_method: method,
    device: { user_agent: navigator.userAgent },
    geolocation: geo.status === 'granted' ? geo.data : null,
    exif,
  };
}
