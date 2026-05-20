import type { JSX } from 'react';

import { AuthLayoutShell } from '@/features/auth/AuthLayoutShell';
import { ResetPasswordPanel } from '@/features/auth/ResetPasswordPanel';

export default async function ResetPasswordPage(): Promise<JSX.Element> {
  return (
    <AuthLayoutShell>
      <ResetPasswordPanel />
    </AuthLayoutShell>
  );
}
