import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { useOffline } from '@/providers/OfflineProvider';

/** Floating pill (bottom-right, above the offline banner) summarising sync work:
 * "N conflicts" / "N failed — retry" / "Syncing N" / "N pending". Hidden when
 * there's nothing to show. */
export function SyncStatusChip() {
  const { t } = useT();
  const { syncState, counts, syncNow, retryFailed, clearConflicts } = useOffline();
  const insets = useSafeAreaInsets();

  const hasConflicts = counts.conflicted > 0;
  const hasFailed = counts.failed > 0;
  const busy = syncState === 'syncing';
  if (!hasConflicts && !hasFailed && counts.pending === 0 && !busy) return null;

  const tone = hasConflicts || hasFailed ? styles.alert : null;
  const label = hasConflicts
    ? t('offline.conflicts', { count: counts.conflicted })
    : hasFailed
      ? t('offline.failed', { count: counts.failed })
      : busy
        ? t('offline.syncing', { count: counts.pending })
        : t('offline.pending', { count: counts.pending });

  const onPress = (): void => {
    if (hasConflicts) {
      Alert.alert(t('offline.conflictTitle'), t('offline.conflictBody'), [
        { text: t('common.close'), onPress: () => { void clearConflicts(); } },
      ]);
    } else if (hasFailed) {
      void retryFailed();
    } else {
      syncNow();
    }
  };

  return (
    <Pressable onPress={onPress} style={[styles.chip, tone, { bottom: insets.bottom + 56 }]}>
      {busy && !hasConflicts && !hasFailed ? (
        <ActivityIndicator size="small" color="#ffffff" />
      ) : null}
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
  alert: { backgroundColor: '#b91c1c' },
  text: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
});
