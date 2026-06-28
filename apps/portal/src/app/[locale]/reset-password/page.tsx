import type { JSX } from 'react';

import { AuthLayoutShell } from '@/features/auth/AuthLayoutShell';
import { ResetPasswordPanel } from '@/features/auth/ResetPasswordPanel';

export default function ResetPasswordPage(): JSX.Element {
  return (
    <AuthLayoutShell>
      <ResetPasswordPanel />
    </AuthLayoutShell>
  );
}
