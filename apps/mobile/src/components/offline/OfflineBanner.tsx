import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { useNetworkStatus } from '@/lib/offline/networkStatus';

/** A thin bar pinned to the bottom of the authenticated area while offline. */
export function OfflineBanner() {
  const { t } = useT();
  const online = useNetworkStatus();
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + 8 }]} pointerEvents="none">
      <Text style={styles.text}>{t('offline.banner')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
    paddingHorizontal: 16,
    backgroundColor: '#334155',
  },
  text: { color: '#ffffff', fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
