/**
 * downloadObjectWithHash buffers an S3 object into a single Uint8Array while
 * streaming its sha256. The fast path pre-sizes from Content-Length (no
 * concat copy); these tests pin the happy path plus the two defensive
 * fallbacks (missing length, under-reported length).
 */

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = sendMock;
  }
  class GetObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  class PutObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  return { S3Client, GetObjectCommand, PutObjectCommand };
});

const { downloadObjectWithHash } = await import('../src/storage/s3.js');

/** A deterministic byte pattern so a wrong offset/length is visible. */
function pattern(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = (i * 31 + 7) & 0xff;
  return out;
}

function streamOf(bytes: Uint8Array, chunkSize: number): Readable {
  const chunks: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(Buffer.from(bytes.subarray(i, i + chunkSize)));
  }
  return Readable.from(chunks);
}

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('downloadObjectWithHash', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('pre-sizes from Content-Length and returns a normalised buffer', async () => {
    const bytes = pattern(10_000);
    sendMock.mockResolvedValue({ Body: streamOf(bytes, 4096), ContentLength: bytes.length });

    const result = await downloadObjectWithHash('key.ifc');

    expect(result.bytes).toEqual(bytes);
    expect(result.sha256).toBe(sha(bytes));
    // Happy path must be a full, normalised view so extract.ts's slice is a no-op.
    expect(result.bytes.byteOffset).toBe(0);
    expect(result.bytes.byteLength).toBe(result.bytes.buffer.byteLength);
  });

  it('falls back to chunk accumulation when Content-Length is absent', async () => {
    const bytes = pattern(8_321);
    sendMock.mockResolvedValue({ Body: streamOf(bytes, 1000) }); // no ContentLength

    const result = await downloadObjectWithHash('key.ifc');

    expect(result.bytes).toEqual(bytes);
    expect(result.sha256).toBe(sha(bytes));
  });

  it('stitches the remainder when Content-Length under-reports the real size', async () => {
    const bytes = pattern(10_000);
    // Server lies: claims 5000 but streams all 10000.
    sendMock.mockResolvedValue({ Body: streamOf(bytes, 4096), ContentLength: 5_000 });

    const result = await downloadObjectWithHash('key.ifc');

    expect(result.bytes).toEqual(bytes);
    expect(result.sha256).toBe(sha(bytes));
  });

  it('truncates to the actual bytes when Content-Length over-reports', async () => {
    const bytes = pattern(6_000);
    sendMock.mockResolvedValue({ Body: streamOf(bytes, 4096), ContentLength: 9_000 });

    const result = await downloadObjectWithHash('key.ifc');

    expect(result.bytes).toEqual(bytes);
    expect(result.sha256).toBe(sha(bytes));
  });
});
