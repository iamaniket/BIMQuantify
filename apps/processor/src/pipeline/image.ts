import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import exifr from 'exifr';

import { postAttachmentCallback } from '../api/attachmentCallback.js';
import { logger } from '../log.js';
import type { ProgressReporter, WorkerJob } from '../queue/queue.js';
import { downloadObjectWithHash } from '../storage/s3.js';
import { classifyError } from './errors.js';

export type ImageMetadataPayload = {
  attachment_id: string;
  project_id: string;
  storage_key: string;
  bucket: string;
};

function parsePayload(raw: Record<string, unknown>): ImageMetadataPayload {
  const attachment_id = raw['attachment_id'];
  const project_id = raw['project_id'];
  const storage_key = raw['storage_key'];
  const bucket = raw['bucket'];
  if (
    typeof attachment_id !== 'string' ||
    typeof project_id !== 'string' ||
    typeof storage_key !== 'string' ||
    typeof bucket !== 'string'
  ) {
    throw new Error(
      `INVALID_IMAGE_PAYLOAD: expected {attachment_id, project_id, storage_key, bucket} as strings, got ${JSON.stringify(raw)}`,
    );
  }
  return { attachment_id, project_id, storage_key, bucket };
}

let cachedVersion: string | null = null;

async function getExtractorVersion(): Promise<string> {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(here, '..', '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    cachedVersion = parsed.version ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  return null;
}

function buildServerMetadata(
  exif: Record<string, unknown>,
  extractorVersion: string,
): Record<string, unknown> {
  const lat = asNumber(exif['latitude']);
  const lon = asNumber(exif['longitude']);
  const alt = asNumber(exif['GPSAltitude']);

  const gps =
    lat !== null && lon !== null
      ? { latitude: lat, longitude: lon, altitude: alt }
      : null;

  const make = asString(exif['Make']);
  const model = asString(exif['Model']);
  const software = asString(exif['Software']);
  const camera = make !== null || model !== null || software !== null
    ? { make, model, software }
    : null;

  const width = asNumber(exif['ImageWidth']) ?? asNumber(exif['ExifImageWidth']);
  const height = asNumber(exif['ImageHeight']) ?? asNumber(exif['ExifImageHeight']);
  const orientation = asNumber(exif['Orientation']);
  const colorSpace = asNumber(exif['ColorSpace']);
  const image = width !== null || height !== null
    ? { width, height, orientation, color_space: colorSpace }
    : null;

  const dateTimeOriginal = exif['DateTimeOriginal'];
  const dto = dateTimeOriginal instanceof Date
    ? dateTimeOriginal.toISOString()
    : asString(dateTimeOriginal);

  const focalLength = asNumber(exif['FocalLength']);
  const fNumber = asNumber(exif['FNumber']);
  const iso = asNumber(exif['ISO']);
  const exposureTime = asNumber(exif['ExposureTime']);
  const flash = asBool(exif['Flash']);

  const capture =
    dto !== null || focalLength !== null || fNumber !== null || iso !== null
      ? {
          date_time_original: dto,
          focal_length: focalLength,
          f_number: fNumber,
          iso,
          exposure_time: exposureTime,
          flash,
        }
      : null;

  return {
    gps,
    camera,
    image,
    capture,
    extracted_at: new Date().toISOString(),
    extractor_version: extractorVersion,
  };
}

export async function runImageMetadataExtraction(
  job: WorkerJob,
  onProgress?: ProgressReporter,
): Promise<void> {
  const payload = parsePayload(job.payload);
  const startedAt = new Date().toISOString();
  const version = await getExtractorVersion();

  await postAttachmentCallback({
    attachment_id: payload.attachment_id,
    organization_id: job.organization_id,
    job_id: job.job_id,
    status: 'running',
    started_at: startedAt,
  });

  try {
    logger.info({ payload }, 'downloading image for EXIF extraction');
    const { bytes } = await downloadObjectWithHash(payload.storage_key, payload.bucket);
    await postAttachmentCallback({
      attachment_id: payload.attachment_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'running',
      started_at: startedAt,
      progress: 50,
    });
    await onProgress?.(50);

    logger.info({ size: bytes.length }, 'extracting EXIF metadata');
    const exif: Record<string, unknown> | null = await exifr.parse(bytes, {
      tiff: true,
      exif: true,
      gps: true,
      ifd0: {},
      translateValues: true,
      translateKeys: false,
      reviveValues: true,
    });

    const serverMetadata = exif !== null
      ? buildServerMetadata(exif, version)
      : { gps: null, camera: null, image: null, capture: null, extracted_at: new Date().toISOString(), extractor_version: version };

    logger.info({ hasExif: exif !== null }, 'EXIF extraction complete');

    await postAttachmentCallback({
      attachment_id: payload.attachment_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'succeeded',
      server_metadata: serverMetadata,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : 'UNKNOWN_ERROR';
    logger.error({ err, payload }, 'image metadata extraction failed');
    const { retriable, error_kind } = classifyError(err);
    await postAttachmentCallback({
      attachment_id: payload.attachment_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'failed',
      error: message.slice(0, 500),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      retriable,
      error_kind,
    });
    throw err;
  }
}
