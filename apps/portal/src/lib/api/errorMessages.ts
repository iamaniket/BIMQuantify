import { ApiError } from './client';

const KNOWN_DETAILS: Record<string, string> = {
  REGISTER_USER_ALREADY_EXISTS: 'An account with this email already exists.',
  LOGIN_BAD_CREDENTIALS: 'Invalid email or password.',
  LOGIN_USER_NOT_VERIFIED: 'Please verify your email before logging in.',
  VERIFY_USER_BAD_TOKEN: 'The verification link is invalid or has expired.',
  RESET_PASSWORD_BAD_TOKEN: 'The password-reset link is invalid or has expired.',
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
