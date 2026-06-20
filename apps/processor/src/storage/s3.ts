import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';

import { getConfig } from '../config.js';
import { logger } from '../log.js';

let cached: S3Client | null = null;

export function getS3(): S3Client {
  if (cached === null) {
    const cfg = getConfig();
    cached = new S3Client({
      endpoint: cfg.S3_ENDPOINT_URL,
      region: cfg.S3_REGION,
      credentials: {
        accessKeyId: cfg.S3_ACCESS_KEY_ID,
        secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true, // required for MinIO
      // Bound two failure modes without endangering legitimate multi-GiB
      // transfers: connectionTimeout fails a stuck CONNECT fast; socketTimeout
      // closes a socket that goes idle (no bytes) for 60s — i.e. a stalled
      // up/download — while a steadily-flowing transfer is never interrupted. A
      // total requestTimeout is deliberately NOT set: it would falsely abort a
      // slow-but-healthy 2 GiB download.
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 15_000,
        socketTimeout: 60_000,
      }),
    });
  }
  return cached;
}

export async function downloadObject(key: string): Promise<Uint8Array> {
  return (await downloadObjectWithHash(key)).bytes;
}

export type DownloadResult = {
  bytes: Uint8Array;
  sha256: string;
};

export async function downloadObjectWithHash(key: string, bucket?: string): Promise<DownloadResult> {
  const cfg = getConfig();
  const response = await getS3().send(
    new GetObjectCommand({ Bucket: bucket ?? cfg.S3_BUCKET_IFC, Key: key }),
  );
  const body = response.Body;
  if (!(body instanceof Readable)) {
    throw new Error(`Unexpected S3 body shape for ${key}`);
  }
  const hasher = createHash('sha256');

  // Fast path: the object's size is known up front (S3/MinIO send Content-Length
  // on every GetObject), so allocate the exact target buffer once and write each
  // chunk straight into it. This avoids the `chunks[] -> Buffer.concat -> copy`
  // sequence, which transiently doubles peak memory on a multi-GiB IFC. The
  // returned view is normalised (byteOffset 0, full length) on the happy path,
  // so downstream `ifcBytes.slice()` normalisation is a no-op for direct .ifc
  // uploads. Falls back to chunk accumulation when the length is unknown
  // (chunked transfer encoding) or wrong (defensive short/over read).
  const contentLength =
    typeof response.ContentLength === 'number' && response.ContentLength >= 0
      ? response.ContentLength
      : null;

  if (contentLength !== null) {
    const bytes = new Uint8Array(contentLength);
    let offset = 0;
    let overflow: Buffer[] | null = null;
    for await (const chunk of body) {
      const buf = chunk as Buffer;
      hasher.update(buf);
      if (overflow === null && offset + buf.length <= contentLength) {
        bytes.set(buf, offset);
        offset += buf.length;
      } else {
        // Content-Length under-reported the real size — keep the remainder
        // aside and stitch it on after the stream drains.
        (overflow ??= []).push(buf);
      }
    }
    if (overflow === null) {
      // Exact (offset === contentLength) or short read: subarray keeps the
      // prefix without a copy; extract.ts normalises the rare short-read view.
      const bytesOut = offset === contentLength ? bytes : bytes.subarray(0, offset);
      return { bytes: bytesOut, sha256: hasher.digest('hex') };
    }
    const tail = overflow.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(offset + tail);
    merged.set(bytes.subarray(0, offset), 0);
    let o = offset;
    for (const c of overflow) {
      merged.set(c, o);
      o += c.length;
    }
    return { bytes: merged, sha256: hasher.digest('hex') };
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    const buf = chunk as Buffer;
    hasher.update(buf);
    chunks.push(buf);
  }
  return {
    bytes: new Uint8Array(Buffer.concat(chunks)),
    sha256: hasher.digest('hex'),
  };
}

export async function uploadObject(
  key: string,
  body: Uint8Array | string,
  contentType: string,
): Promise<void> {
  const cfg = getConfig();
  const startedAt = performance.now();
  await getS3().send(
    new PutObjectCommand({
      Bucket: cfg.S3_BUCKET_IFC,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  // Per-artifact latency makes a slow S3 visible (the orchestrators otherwise
  // only log the aggregate upload time).
  logger.info(
    {
      key,
      bytes: typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength,
      ms: Math.round(performance.now() - startedAt),
    },
    'object uploaded',
  );
}

export function fragmentsKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\.ifc$/i, '.frag');
}

export function outlineKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\.ifc$/i, '.outline.bin');
}

export function floorPlansKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\.ifc$/i, '.floorplans.bin');
}

export function metadataKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\.ifc$/i, '.metadata.json');
}

export function propertiesKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\.ifc$/i, '.properties.json');
}

export function pdfMetadataKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\.pdf$/i, '.metadata.json');
}

export function pdfGeometryKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\.pdf$/i, '.geometry.json');
}

export function dxfGeometryKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\.(dxf|dwg)$/i, '.geometry.json');
}

export function dxfMetadataKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\.(dxf|dwg)$/i, '.metadata.json');
}
