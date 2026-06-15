import { describe, expect, it } from 'vitest';

import { ApiError } from './client';
import { getErrorMessage } from './errorMessages';

describe('getErrorMessage', () => {
  it('prefers the server-localized message when present', () => {
    const err = new ApiError(
      403,
      'INSUFFICIENT_PROJECT_ROLE',
      null,
      'INSUFFICIENT_PROJECT_ROLE',
      'Je hebt onvoldoende rechten voor dit project.',
    );
    expect(getErrorMessage(err)).toBe('Je hebt onvoldoende rechten voor dit project.');
  });

  it('falls back to the known-code map when the server sends no message', () => {
    const err = new ApiError(401, 'LOGIN_BAD_CREDENTIALS');
    expect(getErrorMessage(err)).toBe('Invalid email or password.');
  });

  it('falls back to a structured detail code', () => {
    const err = new ApiError(403, '{"code":"PERMISSION_DENIED"}', { code: 'PERMISSION_DENIED' });
    expect(getErrorMessage(err)).toContain('permission');
  });

  it('falls back to a status message for unmapped codes', () => {
    const err = new ApiError(404, 'SOME_UNMAPPED_CODE');
    expect(getErrorMessage(err)).toBe('The requested resource was not found.');
  });

  it('returns a generic message for non-ApiError values', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('An unexpected error occurred.');
  });
});
