import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOffline } from '@/providers/OfflineProvider';

/** Floating pill (bottom-right, above the offline banner) summarising sync work:
 * "N pending" / "Syncing N" / "N failed — retry". Hidden when there's nothing. */
export function SyncStatusChip() {
  const { syncState, counts, syncNow, retryFailed } = useOffline();
  const insets = useSafeAreaInsets();

  const hasFailed = counts.failed > 0;
  const busy = syncState === 'syncing';
  if (!hasFailed && counts.pending === 0 && !busy) return null;

  const label = hasFailed
    ? `${String(counts.failed)} failed — retry`
    : busy
      ? `Syncing ${String(counts.pending)}`
      : `${String(counts.pending)} pending`;

  return (
    <Pressable
      onPress={() => {
        if (hasFailed) {
          void retryFailed();
        } else {
          syncNow();
        }
      }}
      style={[styles.chip, hasFailed ? styles.failed : null, { bottom: insets.bottom + 56 }]}
    >
      {busy && !hasFailed ? <ActivityIndicator size="small" color="#ffffff" /> : null}
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#334155',
  },
  failed: { backgroundColor: '#b91c1c' },
  text: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
});
