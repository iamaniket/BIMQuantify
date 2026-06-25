import type { JSX } from 'react';

import { Skeleton } from '@bimdossier/ui';

export default function ProjectDetailLoading(): JSX.Element {
  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <Skeleton className="h-32 w-full" />
      <div className="grid flex-1 grid-cols-[2fr_3fr] gap-3.5">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </main>
  );
}
