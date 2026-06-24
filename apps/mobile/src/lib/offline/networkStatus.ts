import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

// Single source of truth for connectivity. A module-level NetInfo subscription
// drives both `useNetworkStatus()` (for offline UI) and React Query's
// onlineManager (so non-offline queries pause when truly offline).

function deriveOnline(state: NetInfoState): boolean {
  // Unknown reachability (null) is treated as online to avoid a false-offline
  // flash on the first tick; only an explicit `false` means offline.
  return state.isConnected !== false && state.isInternetReachable !== false;
}

let online = true;
const listeners = new Set<() => void>();

NetInfo.addEventListener((state) => {
  const next = deriveOnline(state);
  onlineManager.setOnline(next);
  if (next !== online) {
    online = next;
    listeners.forEach((l) => { l(); });
  }
});

export function getNetworkStatus(): boolean {
  return online;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Reactive online/offline flag for components. */
export function useNetworkStatus(): boolean {
  return useSyncExternalStore(subscribe, getNetworkStatus, getNetworkStatus);
}
