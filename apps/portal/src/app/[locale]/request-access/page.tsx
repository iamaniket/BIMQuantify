import type { JSX } from 'react';

import { RequestAccessPanel } from '@/features/access/RequestAccessPanel';
import { AuthLayoutShell } from '@/features/auth/AuthLayoutShell';

export default function RequestAccessPage(): JSX.Element {
  return (
    <AuthLayoutShell>
      <RequestAccessPanel />
    </AuthLayoutShell>
  );
}
