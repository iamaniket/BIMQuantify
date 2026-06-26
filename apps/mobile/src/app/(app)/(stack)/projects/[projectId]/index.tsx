import { Ionicons } from '@expo/vector-icons';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { FindingsList } from '@/features/findings/FindingsList';
import { latestReadyFile, useProjectDocuments } from '@/features/projects/queries';
import { humanize } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { colors, radii } from '@/theme';

type Tab = 'documents' | 'findings';

export default function ProjectScreen() {
  const router = useRouter();
  const { t } = useT();
  const { tokens } = useAuth();
  const params = useLocalSearchParams<{ projectId: string; name?: string }>();
  const projectId = params.projectId;
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('documents');

  if (tokens === null) {
    return <Redirect href="/login" />;
  }
  if (projectId === undefined || projectId === '') {
    return <Redirect href="/projects" />;
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: params.name ?? t('project.documentsTitle') }} />

      {/* Documents | Findings segmented toggle */}
      <View style={styles.segmented}>
        <SegmentButton
          label={t('project.documentsTab')}
          active={tab === 'documents'}
          onPress={() => { setTab('documents'); }}
        />
        <SegmentButton
          label={t('project.findingsTab')}
          active={tab === 'findings'}
          onPress={() => { setTab('findings'); }}
        />
      </View>

      <View style={styles.flex}>
        {tab === 'documents' ? (
          <DocumentsTab projectId={projectId} />
        ) : (
          <FindingsList projectId={projectId} />
        )}
      </View>

      {/* Add a snag without opening the model. Pins-from-viewer add anchored
          findings; this entry point creates an unanchored one (all link/anchor
          fields null — the create form and API both allow it). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('project.addSnag')}
        style={({ pressed }) => [
          styles.fab,
          { bottom: Math.max(insets.bottom, 16) + 16 },
          pressed && styles.fabPressed,
        ]}
        onPress={() => {
          router.push({
            pathname: '/projects/[projectId]/findings/create',
            params: { projectId },
          });
        }}
      >
        <Ionicons name="add" size={28} color={colors.onPrimary} />
      </Pressable>
    </View>
  );
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segment, active && styles.segmentActive]} onPress={onPress}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

function DocumentsTab({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { t } = useT();
  const { data, isLoading, isError, refetch, isRefetching } = useProjectDocuments(projectId);

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
        <Text style={styles.muted}>{t('project.loadDocumentsError')}</Text>
        <Pressable style={styles.retry} onPress={() => { void refetch(); }}>
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(m) => m.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} />
      }
      ListEmptyComponent={
        <View style={styles.centered}><Text style={styles.muted}>{t('project.noDocuments')}</Text></View>
      }
      renderItem={({ item }) => {
        const ready = latestReadyFile(item);
        const disabled = ready === null;
        return (
          <Pressable
            style={[styles.row, disabled && styles.rowDisabled]}
            disabled={disabled}
            onPress={() => {
              if (ready !== null) {
                router.push({
                  pathname: '/viewer/[projectId]/[modelId]/[fileId]',
                  params: { projectId, modelId: item.id, fileId: ready.id },
                });
              }
            }}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.rowSub}>
                {humanize(item.discipline)}{disabled ? ` · ${t('project.processing')}` : ''}
              </Text>
            </View>
            {disabled ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.chevron}>›</Text>
            )}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { fontSize: 15, color: colors.textMuted },
  retry: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: radii.sm, backgroundColor: colors.primary },
  retryText: { color: colors.onPrimary, fontWeight: '600' },
  segmented: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  segmentTextActive: { color: colors.onPrimary },
  list: { paddingHorizontal: 16, paddingVertical: 16, gap: 10, maxWidth: 760, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: colors.surface,
  },
  rowDisabled: { opacity: 0.5 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 26, color: colors.textMuted, fontWeight: '300' },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabPressed: { opacity: 0.85 },
});
