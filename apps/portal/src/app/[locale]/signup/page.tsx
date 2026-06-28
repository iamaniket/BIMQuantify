import type { JSX } from 'react';

import { AuthLayoutShell } from '@/features/auth/AuthLayoutShell';
import { SignupPanel } from '@/features/auth/SignupPanel';

/**
 * Public free-tier signup. Reuses the shared auth chrome (left-side brand pane
 * + map) like /activate and /forgot-password; the email-entry form lives in
 * SignupPanel. Backed by `POST /auth/signup` (mounted only when
 * FREE_TIER_ENABLED) → activation email → /activate.
 */
export default function SignupPage(): JSX.Element {
  return (
    <AuthLayoutShell>
      <SignupPanel />
    </AuthLayoutShell>
  );
}
