import NetInfo from '@react-native-community/netinfo';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { clearConflicted, listActive, resetFailedToPending } from '@/lib/offline/outbox';
import { syncEngine, type SyncState } from '@/lib/offline/sync';
import type { OutboxEntry } from '@/lib/offline/types';
import { useAuth } from '@/providers/AuthProvider';

type OfflineValue = {
  /** Every not-yet-synced outbox entry, for badges and the status chip. */
  pending: OutboxEntry[];
  syncState: SyncState;
  counts: { pending: number; failed: number; conflicted: number };
  /** Reload the pending snapshot from the DB. */
  refresh: () => Promise<void>;
  /** Kick a sync pass now (no-op if offline / already syncing). */
  syncNow: () => void;
  /** Re-arm failed entries and sync. */
  retryFailed: () => Promise<void>;
  /** Drop conflicted entries (server already won). */
  clearConflicts: () => Promise<void>;
};

const OfflineContext = createContext<OfflineValue | null>(null);

/**
 * Owns the SyncEngine lifecycle and the pending-outbox snapshot. Triggers a sync
 * on reconnect and app-foreground (plus a one-shot backoff retry from the engine
 * itself); there is deliberately no periodic poll. Must sit inside AuthProvider
 * (it reads the token) and QueryProvider.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const { tokens } = useAuth();
  const tokenRef = useRef<string | null>(tokens?.access_token ?? null);
  tokenRef.current = tokens?.access_token ?? null;

  const [pending, setPending] = useState<OutboxEntry[]>([]);
  const [syncState, setSyncState] = useState<SyncState>('idle');

  const refresh = useCallback(async (): Promise<void> => {
    const entries = await listActive();
    setPending(entries);
    setSyncState(syncEngine.getState());
  }, []);

  const syncNow = useCallback((): void => {
    syncEngine.run().catch(() => undefined);
  }, []);

  const retryFailed = useCallback(async (): Promise<void> => {
    await resetFailedToPending();
    await refresh();
    syncEngine.run().catch(() => undefined);
  }, [refresh]);

  const clearConflicts = useCallback(async (): Promise<void> => {
    await clearConflicted();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    syncEngine.configure(
      () => tokenRef.current,
      () => { void refresh(); },
    );
    void refresh();
    syncEngine.run().catch(() => undefined);

    const netUnsub = NetInfo.addEventListener((state) => {
      if (state.isConnected !== false && state.isInternetReachable !== false) {
        syncEngine.run().catch(() => undefined);
      }
    });
    const appSub = AppState.addEventListener('change', (status) => {
      if (status === 'active') syncEngine.run().catch(() => undefined);
    });
    return () => {
      netUnsub();
      appSub.remove();
      syncEngine.stop();
    };
  }, [refresh]);

  const counts = useMemo(
    () => ({
      pending: pending.filter((e) => e.status === 'pending' || e.status === 'syncing').length,
      failed: pending.filter((e) => e.status === 'failed').length,
      conflicted: pending.filter((e) => e.status === 'conflicted').length,
    }),
    [pending],
  );

  const value = useMemo<OfflineValue>(
    () => ({ pending, syncState, counts, refresh, syncNow, retryFailed, clearConflicts }),
    [pending, syncState, counts, refresh, syncNow, retryFailed, clearConflicts],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineValue {
  const ctx = useContext(OfflineContext);
  if (ctx === null) {
    throw new Error('useOffline must be used within an OfflineProvider');
  }
  return ctx;
}
