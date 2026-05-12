import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequestAccessClient } from '@/features/access/RequestAccessClient';

export const metadata: Metadata = {
  title: 'BimStitch — Request access',
  description: 'Request a guided demo of BimStitch — Wkb-compliant BIM platform.',
};

export default function RequestAccessPage(): JSX.Element {
  return <RequestAccessClient />;
}
