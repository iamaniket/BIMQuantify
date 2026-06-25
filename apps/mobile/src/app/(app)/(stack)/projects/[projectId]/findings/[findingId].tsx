import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useFinding } from '@/features/findings/queries';
import { humanize } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { colors, radii } from '@/theme';

function severityColor(severity: string): string {
  switch (severity) {
    case 'high': return colors.error;
    case 'medium': return colors.warning;
    default: return colors.info;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'open': return colors.error;
    case 'in_progress': return colors.warning;
    case 'resolved': return colors.success;
    case 'verified': return colors.success;
    default: return colors.textMuted;
  }
}

export default function FindingDetailScreen() {
  const router = useRouter();
  const { tokens } = useAuth();
  const { projectId, findingId } = useLocalSearchParams<{
    projectId: string;
    findingId: string;
  }>();
  const { data: finding, isLoading, isError, refetch } = useFinding(
    projectId ?? '',
    findingId ?? '',
  );

  if (tokens === null) return <Redirect href="/login" />;
  if (!projectId || !findingId) return <Redirect href="/projects" />;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: finding?.title ?? 'Finding' }} />

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError || !finding ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>Couldn't load finding.</Text>
          <Pressable style={styles.retry} onPress={() => { void refetch(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Status + Severity badges */}
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: statusColor(finding.status) }]}>
              <Text style={styles.badgeText}>{humanize(finding.status)}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: severityColor(finding.severity) }]}>
              <Text style={styles.badgeText}>{humanize(finding.severity)}</Text>
            </View>
          </View>

          {/* Title */}
          <Text style={styles.title}>{finding.title}</Text>

          {/* Description */}
          <Text style={styles.description}>{finding.description}</Text>

          {/* Metadata fields */}
          <View style={styles.section}>
            {finding.bbl_article_ref ? (
              <MetaRow label="BBL Article" value={finding.bbl_article_ref} />
            ) : null}
            {finding.deadline_date ? (
              <MetaRow label="Deadline" value={finding.deadline_date.slice(0, 10)} />
            ) : null}
            {finding.linked_file_type ? (
              <MetaRow label="Anchor" value={anchorSummary(finding)} />
            ) : null}
          </View>

          {/* Resolution */}
          {finding.resolution_note ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Resolution</Text>
              <Text style={styles.description}>{finding.resolution_note}</Text>
            </View>
          ) : null}

          {/* Navigate to viewer if pinned on IFC model */}
          {finding.linked_file_type === 'ifc' && finding.linked_document_id && finding.linked_file_id ? (
            <Pressable
              style={styles.viewBtn}
              onPress={() => {
                router.push({
                  pathname: '/viewer/[projectId]/[modelId]/[fileId]',
                  params: {
                    projectId,
                    modelId: finding.linked_document_id!,
                    fileId: finding.linked_file_id!,
                  },
                });
              }}
            >
              <Text style={styles.viewBtnText}>View in 3D</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function anchorSummary(f: {
  linked_file_type: string | null;
  anchor_page: number | null;
  anchor_x: number | null;
  anchor_y: number | null;
  anchor_z: number | null;
}): string {
  if (f.linked_file_type === 'pdf' && f.anchor_page != null) {
    return `PDF Page ${String(f.anchor_page)}`;
  }
  if (f.linked_file_type === 'ifc' && f.anchor_x != null) {
    return `3D (${f.anchor_x.toFixed(1)}, ${f.anchor_y?.toFixed(1)}, ${f.anchor_z?.toFixed(1)})`;
  }
  return humanize(f.linked_file_type ?? '');
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { fontSize: 15, color: colors.textMuted },
  retry: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: radii.sm, backgroundColor: colors.primary },
  retryText: { color: colors.onPrimary, fontWeight: '600' },
  scroll: { padding: 20, gap: 16, maxWidth: 760, width: '100%', alignSelf: 'center' },
  badgeRow: { flexDirection: 'row', gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  badgeText: { color: '#ffffff', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  description: { fontSize: 15, color: colors.textSecondary, lineHeight: 22 },
  section: { gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaLabel: { fontSize: 14, color: colors.textMuted },
  metaValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  viewBtn: {
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    marginTop: 8,
  },
  viewBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
});
