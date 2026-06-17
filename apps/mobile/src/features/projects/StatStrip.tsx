import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii } from '@/theme';

import type { ProjectCounts } from './projectStats';

interface Stat {
  key: string;
  value: number;
  sub: string;
  accent?: boolean;
}

/**
 * Tablet stat strip (design `StatGrid`). Four cards derived from the portfolio
 * counts; "Active" gets the success accent, the rest stay neutral.
 */
export function StatStrip({ counts, cols = 4 }: { counts: ProjectCounts; cols?: number }) {
  const stats: Stat[] = [
    { key: 'Active', value: counts.active, sub: `${counts.total} total`, accent: true },
    { key: 'In construction', value: counts.construction, sub: `${counts.design} in design` },
    { key: 'In design', value: counts.design, sub: 'in progress' },
    { key: 'Archived', value: counts.archived, sub: counts.archived === 0 ? 'none' : 'closed' },
  ];

  return (
    <View style={styles.grid}>
      {stats.map((s) => (
        <View key={s.key} style={[styles.card, { width: `${100 / cols}%` }]}>
          <View style={styles.cardInner}>
            <Text style={styles.label} numberOfLines={1}>
              {s.key.toUpperCase()}
            </Text>
            <Text style={[styles.value, s.accent ? styles.accent : null]}>{s.value}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {s.sub}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { padding: 5 },
  cardInner: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  label: { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: colors.textMuted },
  value: { fontFamily: fonts.displaySemibold, fontSize: 26, color: colors.text, marginTop: 3 },
  accent: { color: colors.success },
  sub: { fontSize: 10.5, color: colors.textMuted, marginTop: 1 },
});
