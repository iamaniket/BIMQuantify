import type { JSX } from 'react';

import { AuthLayoutShell } from '@/features/auth/AuthLayoutShell';
import { ForgotPasswordPanel } from '@/features/auth/ForgotPasswordPanel';

export default async function ForgotPasswordPage(): Promise<JSX.Element> {
  return (
    <AuthLayoutShell>
      <ForgotPasswordPanel />
    </AuthLayoutShell>
  );
}
