/**
 * Failure classification — the signal that drives the portal's Retry
 * affordance. Permanent failures must never be offered a retry; transient
 * ones must be; anything unrecognised defaults to retriable (safe).
 */

import { describe, expect, it } from 'vitest';

import {
  classifyError,
  PermanentError,
  RetriableError,
} from '../src/pipeline/errors.js';
import { NoIfcInZipError } from '../src/pipeline/unzip.js';

describe('classifyError', () => {
  it('honours an explicit PermanentError', () => {
    expect(classifyError(new PermanentError('bad input', 'parse'))).toEqual({
      retriable: false,
      error_kind: 'parse',
    });
  });

  it('honours an explicit RetriableError', () => {
    expect(classifyError(new RetriableError('blip', 'network'))).toEqual({
      retriable: true,
      error_kind: 'network',
    });
  });

  it.each([
    ['UNSUPPORTED_SCHEMA: IFC4X9', 'unsupported_schema'],
    ['INVALID_IFC_PAYLOAD: missing file_id', 'payload'],
    ['NO_IFC_IN_ZIP', 'parse'],
    ['NO_IFC_ENTRY_IN_ZIP', 'parse'],
    ['file is corrupt', 'parse'],
    ['payload failed validation', 'validation'],
    ['sha256 hash mismatch', 'hash_mismatch'],
    ['object not found (404)', 'not_found'],
  ])('classifies %j as permanent', (message, kind) => {
    expect(classifyError(new Error(message))).toEqual({
      retriable: false,
      error_kind: kind,
    });
  });

  it.each([
    ['ECONNREFUSED connecting to api', 'network'],
    ['request timed out', 'timeout'],
    ['fetch failed', 'network'],
    ['S3 GetObject failed', 's3'],
    ['JS heap out of memory', 'oom'],
    ['upstream returned 503', 'upstream'],
  ])('classifies %j as retriable', (message, kind) => {
    expect(classifyError(new Error(message))).toEqual({
      retriable: true,
      error_kind: kind,
    });
  });

  it('classifies the real NoIfcInZipError instance as permanent', () => {
    // Pin to the actual thrown message so the regex can never drift away from it.
    expect(classifyError(new NoIfcInZipError())).toEqual({
      retriable: false,
      error_kind: 'parse',
    });
  });

  it('defaults an unrecognised error to retriable/unknown', () => {
    expect(classifyError(new Error('something weird happened'))).toEqual({
      retriable: true,
      error_kind: 'unknown',
    });
  });

  it('defaults a non-Error throw to retriable/unknown', () => {
    expect(classifyError('a bare string')).toEqual({
      retriable: true,
      error_kind: 'unknown',
    });
  });
});
