'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { useNetworkStatus } from '@/lib/offline/networkStatus.js';
import { getQueueStats, resetFailedToPending } from '@/lib/offline/queue.js';
import { getSyncEngine, type SyncState } from '@/lib/offline/sync.js';

export function OfflineBanner(): JSX.Element | null {
  const t = useTranslations('offline.banner');
  const { isOnline } = useNetworkStatus();
  const [syncState, setSyncState] = useState<SyncState>({ phase: 'idle' });
  const [failedCount, setFailedCount] = useState(0);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    const engine = getSyncEngine();
    return engine.subscribe(setSyncState);
  }, []);

  useEffect(() => {
    void getQueueStats().then((stats) => { setFailedCount(stats.failed); });
  }, [syncState]);

  useEffect(() => {
    if (syncState.phase === 'done') {
      setShowDone(true);
      const timer = setTimeout(() => { setShowDone(false); }, 3000);
      return () => { clearTimeout(timer); };
    }
    setShowDone(false);
    return undefined;
  }, [syncState]);

  const handleRetry = useCallback(() => {
    void resetFailedToPending().then(() => {
      void getSyncEngine().syncNow();
    });
  }, []);

  if (isOnline && syncState.phase === 'idle' && failedCount === 0) return null;
  if (isOnline && syncState.phase === 'done' && !showDone) return null;

  let bg = 'bg-warning/90';
  let content: JSX.Element;

  if (!isOnline) {
    content = <span>{t('offline')}</span>;
  } else if (syncState.phase === 'syncing') {
    bg = 'bg-primary/90';
    content = (
      <span className="flex items-center justify-center gap-2">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
        {t('syncing', { count: syncState.total - syncState.completed })}
      </span>
    );
  } else if (syncState.phase === 'done' && showDone) {
    bg = 'bg-success/90';
    content = <span>{t('syncComplete')}</span>;
  } else if (failedCount > 0) {
    content = (
      <button type="button" onClick={handleRetry} className="underline underline-offset-2">
        {t('failed', { count: failedCount })}
      </button>
    );
  } else {
    return null;
  }

  return (
    <div className={`${bg} px-4 py-2 text-center text-body3 font-medium text-white`}>
      {content}
    </div>
  );
}
