import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import type { EmbedViewerBundle } from '@/lib/api/viewerBundle';

import { getPinnedBundle, isPinned, pinModel, unpinModel } from './pinStore';

export type PinForOffline = {
  pinned: boolean;
  busy: boolean;
  /** The local file:// manifest, available once pinned (used offline). */
  localBundle: EmbedViewerBundle | null;
  pin: (bundle: EmbedViewerBundle) => Promise<void>;
  unpin: () => Promise<void>;
};

/** Track and toggle a model's offline pin. `pin` is called with the live
 * (presigned) bundle while online; `localBundle` is what the viewer hands the
 * embed when offline. */
export function usePinForOffline(
  projectId: string,
  modelId: string,
  fileId: string,
): PinForOffline {
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localBundle, setLocalBundle] = useState<EmbedViewerBundle | null>(null);

  useEffect(() => {
    if (fileId.length === 0) return;
    let active = true;
    void (async () => {
      const has = await isPinned(fileId);
      if (!active) return;
      setPinned(has);
      setLocalBundle(has ? await getPinnedBundle(fileId) : null);
    })();
    return () => {
      active = false;
    };
  }, [fileId]);

  const pin = useCallback(
    async (bundle: EmbedViewerBundle): Promise<void> => {
      if (fileId.length === 0) return;
      setBusy(true);
      try {
        const local = await pinModel(projectId, modelId, fileId, bundle);
        setLocalBundle(local);
        setPinned(true);
      } catch (err) {
        Alert.alert(
          'Download failed',
          err instanceof Error ? err.message : 'Could not save this model for offline use.',
        );
      } finally {
        setBusy(false);
      }
    },
    [projectId, modelId, fileId],
  );

  const unpin = useCallback(async (): Promise<void> => {
    if (fileId.length === 0) return;
    setBusy(true);
    try {
      await unpinModel(fileId);
      setLocalBundle(null);
      setPinned(false);
    } finally {
      setBusy(false);
    }
  }, [fileId]);

  return { pinned, busy, localBundle, pin, unpin };
}
