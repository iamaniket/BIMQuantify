import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { getConfig } from '../config.js';

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
  await getS3().send(
    new PutObjectCommand({
      Bucket: cfg.S3_BUCKET_IFC,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export function fragmentsKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\.ifc$/i, '.frag');
}

export function outlineKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\.ifc$/i, '.outline.bin');
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
