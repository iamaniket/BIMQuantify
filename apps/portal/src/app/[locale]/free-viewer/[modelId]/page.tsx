'use client';

import { useParams } from 'next/navigation';
import type { JSX } from 'react';

import { FreeModelViewer } from '@/features/free-viewer/FreeModelViewer';

export default function FreeModelViewerPage(): JSX.Element {
  const { modelId } = useParams<{ modelId: string }>();
  return <FreeModelViewer modelId={modelId} />;
}
