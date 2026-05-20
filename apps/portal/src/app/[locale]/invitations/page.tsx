import type { JSX } from 'react';

import { AuthLayoutShell } from '@/features/auth/AuthLayoutShell';
import { InvitationsPanel } from '@/features/auth/InvitationsPanel';

export default async function InvitationsPage(): Promise<JSX.Element> {
  return (
    <AuthLayoutShell>
      <InvitationsPanel />
    </AuthLayoutShell>
  );
}
