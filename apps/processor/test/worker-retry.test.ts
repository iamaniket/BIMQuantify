/**
 * Retry gating: permanently-bad inputs become BullMQ UnrecoverableError (one
 * attempt, not `attempts`), and the terminal-failure backstop fires for them
 * even though attemptsMade is still 1. Pure helpers, no Redis/BullMQ runtime.
 */

import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';

import { PermanentError, RetriableError } from '../src/pipeline/errors.js';
import { isTerminalFailure, toBullError } from '../src/queue/worker.js';

describe('toBullError', () => {
  it('wraps a PermanentError as UnrecoverableError, preserving the message', () => {
    const out = toBullError(new PermanentError('DXF_PARSE_FAILED: bad', 'parse'));
    expect(out).toBeInstanceOf(UnrecoverableError);
    expect(out.message).toBe('DXF_PARSE_FAILED: bad');
  });

  it.each([
    'UNSUPPORTED_SCHEMA: IFC2X2',
    'INVALID_IFC_PAYLOAD: missing file_id',
    'NO_IFC_ENTRY_IN_ZIP',
    'content hash_mismatch',
  ])('wraps a message-classified permanent failure (%s)', (message) => {
    expect(toBullError(new Error(message))).toBeInstanceOf(UnrecoverableError);
  });

  it('passes a RetriableError through unchanged (still retried)', () => {
    const err = new RetriableError('s3 hiccup', 's3');
    const out = toBullError(err);
    expect(out).toBe(err);
    expect(out).not.toBeInstanceOf(UnrecoverableError);
  });

  it.each(['ECONNRESET while fetching', 'request timed out', 'out of memory'])(
    'passes a retriable-classified failure through unchanged (%s)',
    (message) => {
      expect(toBullError(new Error(message))).not.toBeInstanceOf(UnrecoverableError);
    },
  );

  it('treats an unknown error as retriable (no wrap)', () => {
    expect(toBullError(new Error('something nobody anticipated'))).not.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});

describe('isTerminalFailure', () => {
  it('is terminal for an UnrecoverableError even on the first attempt', () => {
    expect(isTerminalFailure(1, 3, new UnrecoverableError('x'))).toBe(true);
  });

  it('is terminal when a same-named error crosses a module boundary', () => {
    const err = new Error('x');
    err.name = 'UnrecoverableError';
    expect(isTerminalFailure(1, 3, err)).toBe(true);
  });

  it('is not terminal for a retriable failure with attempts left', () => {
    expect(isTerminalFailure(1, 3, new RetriableError('blip'))).toBe(false);
  });

  it('is terminal once retries are exhausted', () => {
    expect(isTerminalFailure(3, 3, new RetriableError('blip'))).toBe(true);
  });
});
