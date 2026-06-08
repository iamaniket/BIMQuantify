'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Plain getter (for non-React sync code like the sync engine)
// ---------------------------------------------------------------------------

export function getNetworkStatus(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

// ---------------------------------------------------------------------------
// React hook — useNetworkStatus()
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);

  const onOnline = (): void => {
    for (const listener of listeners) listener();
  };
  const onOffline = (): void => {
    for (const listener of listeners) listener();
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    listeners.delete(cb);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useNetworkStatus(): { isOnline: boolean } {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { isOnline };
}
