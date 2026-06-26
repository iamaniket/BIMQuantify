import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '@/i18n';
import type { Locale } from '@/i18n';
import { colors, radii } from '@/theme';

/** Settings: manual NL/EN language override (persisted; otherwise the app follows
 * the device locale, falling back to Dutch). */
export default function SettingsScreen() {
  const { t, locale, setLocale } = useT();

  const options: { value: Locale; label: string }[] = [
    { value: 'nl', label: t('settings.languageDutch') },
    { value: 'en', label: t('settings.languageEnglish') },
  ];

  return (
    <View style={styles.root}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, gap: 10, backgroundColor: colors.background },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
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
});
