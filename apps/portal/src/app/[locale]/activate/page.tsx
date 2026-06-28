import type { JSX } from 'react';

import { ActivatePanel } from '@/features/auth/ActivatePanel';
import { AuthLayoutShell } from '@/features/auth/AuthLayoutShell';

export default function ActivatePage(): JSX.Element {
  return (
    <AuthLayoutShell>
      <ActivatePanel />
    </AuthLayoutShell>
  );
}
