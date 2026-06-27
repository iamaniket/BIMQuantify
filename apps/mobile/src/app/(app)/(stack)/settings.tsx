import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { clearAllPinnedFiles } from '@/features/viewer/offline/pinStore';
import { useT } from '@/i18n';
import type { Locale } from '@/i18n';
import { wipeAllOfflineData } from '@/lib/offline/db';
import { getOfflineStorageStats, type OfflineStorageStats } from '@/lib/offline/stats';
import { formatBytes } from '@/lib/format';
import { colors, radii } from '@/theme';

/** Settings: NL/EN language override + offline-data management (usage + clear).
 * The language choice persists in secure-store; clearing offline data wipes the
 * SQLite cache + downloaded models but leaves the user signed in. */
export default function SettingsScreen() {
  const { t, locale, setLocale } = useT();
  const queryClient = useQueryClient();

  const options: { value: Locale; label: string }[] = [
    { value: 'nl', label: t('settings.languageDutch') },
    { value: 'en', label: t('settings.languageEnglish') },
  ];

  const [stats, setStats] = useState<OfflineStorageStats | null>(null);
  const [clearing, setClearing] = useState(false);

  const loadStats = useCallback(() => {
    void getOfflineStorageStats()
      .then(setStats)
      .catch(() => { setStats(null); });
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const doClear = useCallback(async () => {
    setClearing(true);
    try {
      await clearAllPinnedFiles();
      await wipeAllOfflineData();
      await queryClient.invalidateQueries();
      loadStats();
      Alert.alert(t('settings.offline.cleared'));
    } finally {
      setClearing(false);
    }
  }, [queryClient, loadStats, t]);

  const confirmClear = useCallback(() => {
    const pending = stats?.pendingWrites ?? 0;
    Alert.alert(
      t('settings.offline.clearConfirmTitle'),
      pending > 0
        ? t('settings.offline.clearConfirmBodyPending', { count: pending })
        : t('settings.offline.clearConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.offline.clear'), style: 'destructive', onPress: () => { void doClear(); } },
      ],
    );
  }, [stats, t, doClear]);

  const isEmpty =
    stats !== null &&
    stats.projects === 0 &&
    stats.findings === 0 &&
    stats.documents === 0 &&
    stats.pinnedCount === 0;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>{t('settings.language')}</Text>
      <View style={styles.segmented}>
        {options.map((opt) => {
          const active = opt.value === locale;
          return (
            <Pressable
              key={opt.value}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => { setLocale(opt.value); }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, styles.sectionGap]}>{t('settings.offline.title')}</Text>
      <View style={styles.card}>
        {stats === null ? (
          <ActivityIndicator color={colors.primary} />
        ) : isEmpty ? (
          <Text style={styles.usage}>{t('settings.offline.empty')}</Text>
        ) : (
          <>
            <Text style={styles.usage}>
              {t('settings.offline.cached', {
                projects: stats.projects,
                findings: stats.findings,
                documents: stats.documents,
              })}
            </Text>
            {stats.pinnedCount > 0 ? (
              <Text style={styles.usage}>
                {t('settings.offline.pinned', {
                  models: stats.pinnedCount,
                  size: formatBytes(stats.pinnedBytes),
                })}
              </Text>
            ) : null}
            {stats.pendingWrites > 0 ? (
              <Text style={styles.pending}>{t('offline.pending', { count: stats.pendingWrites })}</Text>
            ) : null}
          </>
        )}

        <Pressable
          style={[styles.clearButton, (clearing || isEmpty) && styles.clearButtonDisabled]}
          onPress={confirmClear}
          disabled={clearing || isEmpty}
          accessibilityRole="button"
        >
          {clearing ? (
            <ActivityIndicator color={colors.error} />
          ) : (
            <Text style={styles.clearText}>{t('settings.offline.clear')}</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  sectionGap: { marginTop: 18 },
  segmented: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
  segmentTextActive: { color: colors.onPrimary },
  card: {
    gap: 10,
    padding: 16,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  usage: { fontSize: 14, color: colors.text, lineHeight: 20 },
  pending: { fontSize: 13, color: colors.textMuted },
  clearButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.error,
    marginTop: 2,
  },
  clearButtonDisabled: { opacity: 0.4 },
  clearText: { fontSize: 15, fontWeight: '700', color: colors.error },
});
