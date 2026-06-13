import { ApiError } from './client';

const KNOWN_DETAILS: Record<string, string> = {
  REGISTER_USER_ALREADY_EXISTS: 'An account with this email already exists.',
  LOGIN_BAD_CREDENTIALS: 'Invalid email or password.',
  LOGIN_USER_NOT_VERIFIED: 'Please verify your email before logging in.',
  VERIFY_USER_BAD_TOKEN: 'The verification link is invalid or has expired.',
  RESET_PASSWORD_BAD_TOKEN: 'The password-reset link is invalid or has expired.',
  SEAT_LIMIT_EXCEEDED: 'Seat limit reached. Raise the limit or remove a member before inviting.',
  SEAT_LIMIT_BELOW_USAGE: 'New seat limit is below the current usage.',
  ORG_SUSPENDED: 'This workspace is suspended. Contact a super-admin to restore access.',
  ORG_MEMBER_ALREADY_EXISTS: 'That user is already a member of this workspace.',
  CANNOT_DEACTIVATE_SELF: 'You cannot deactivate your own account.',
  CANNOT_DELETE_DEFAULT_TEMPLATE: 'You can’t delete the default template. Set another as default first.',
  DEFAULT_TEMPLATE_CONFLICT: 'Another template was just set as default. Please try again.',
  FINDING_TEMPLATE_NOT_FOUND: 'That template no longer exists.',
  // Project-role gating backstop. UI gating should keep users from triggering
  // this, but if a stale view lets one through, show a clear message instead of
  // the raw serialized detail object.
  PERMISSION_DENIED: 'You don’t have permission to perform this action.',
};

const STATUS_MESSAGES: Record<number, string> = {
  401: 'Session expired. Please log in again.',
  403: 'You don\u2019t have permission to perform this action.',
  404: 'The requested resource was not found.',
  409: 'A conflict occurred. The resource may already exist.',
  413: 'The file is too large.',
  422: 'The input is invalid. Please check the form and try again.',
  429: 'Too many requests. Please wait a moment and try again.',
};

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'An unexpected error occurred.';
  }

  // Structured detail objects ({ code, ... }) — e.g. PERMISSION_DENIED — carry
  // the SCREAMING_SNAKE code in `code`; map it before falling back to the raw
  // (JSON-stringified) detail text.
  const code = error.detailObject !== null ? error.detailObject['code'] : undefined;
  if (typeof code === 'string' && KNOWN_DETAILS[code] !== undefined) {
    return KNOWN_DETAILS[code];
  }

  const knownDetail = KNOWN_DETAILS[error.detail];
  if (knownDetail !== undefined) {
    return knownDetail;
  }

  const statusMessage = STATUS_MESSAGES[error.status];
  if (statusMessage !== undefined) {
    return statusMessage;
  }

  if (error.status >= 500) {
    return 'Something went wrong. Please try again later.';
  }

  return error.detail;
}
