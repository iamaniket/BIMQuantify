import type { JSX } from 'react';

import { RequestAccessPanel } from '@/features/access/RequestAccessPanel';
import { AuthLayoutShell } from '@/features/auth/AuthLayoutShell';

export default async function RequestAccessPage(): Promise<JSX.Element> {
  return (
    <AuthLayoutShell>
      <RequestAccessPanel />
    </AuthLayoutShell>
  );
}
