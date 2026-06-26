import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useT } from '@/i18n';
import { isPendingFindingId } from '@/features/findings/offline';
import { useProjectFindings } from '@/features/findings/queries';
import { severityColor, statusColor } from '@/features/findings/findingStyle';
import type { Finding } from '@/lib/api/schemas/findings';
import { formatShortDate } from '@/lib/format';
import { colors, radii } from '@/theme';

/** The Findings tab of the project screen: every finding in the project, tap to
 * open its detail. Created findings (3D-pin or the snag FAB) land here. */
export function FindingsList({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { t } = useT();
  const { data, isLoading, isError, refetch, isRefetching } = useProjectFindings(projectId);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t('findings.list.loadError')}</Text>
        <Pressable style={styles.retry} onPress={() => { void refetch(); }}>
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(f) => f.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} />
      }
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={styles.muted}>{t('findings.list.empty')}</Text>
        </View>
      }
      renderItem={({ item }) => <FindingRow finding={item} onPress={() => {
        router.push({
          pathname: '/projects/[projectId]/findings/[findingId]',
          params: { projectId, findingId: item.id },
        });
      }} />}
    />
  );
}

function FindingRow({ finding, onPress }: { finding: Finding; onPress: () => void }) {
  const { t } = useT();
  const pending = isPendingFindingId(finding.id);
  const pinned = finding.linked_file_type !== null;
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.statusDot, { backgroundColor: statusColor(finding.status) }]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>{finding.title}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.sevPill, { backgroundColor: severityColor(finding.severity) }]}>
            <Text style={styles.sevText}>{t(`findings.severity.${finding.severity}`)}</Text>
          </View>
          <Text style={styles.metaText} numberOfLines={1}>
            {t(`findings.status.${finding.status}`)}
            {pinned ? '  · 📍' : ''}
            {'  · '}
            {formatShortDate(finding.created_at)}
          </Text>
        </View>
      </View>
      {pending ? (
        <View style={styles.pendingChip}>
          <Text style={styles.pendingText}>{t('findings.list.notSynced')}</Text>
        </View>
      ) : (
        <Text style={styles.chevron}>›</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { fontSize: 15, color: colors.textMuted },
  retry: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: radii.sm, backgroundColor: colors.primary },
  retryText: { color: colors.onPrimary, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingVertical: 16, gap: 10, maxWidth: 760, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sevPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill },
  sevText: { color: '#ffffff', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  metaText: { flex: 1, fontSize: 13, color: colors.textMuted },
  chevron: { fontSize: 26, color: colors.textMuted, fontWeight: '300' },
  pendingChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: '#33415522',
  },
  pendingText: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
});
