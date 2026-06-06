import type { JSX } from 'react';

import { Skeleton } from '@bimstitch/ui';

export default function DashboardLoading(): JSX.Element {
  return (
    <main className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      {/* Page header placeholder */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      {/* Card grid placeholder */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col overflow-hidden rounded-lg border border-border">
            <Skeleton className="h-36 w-full" />
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="border-t border-border px-4 py-3">
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
