import { Ionicons } from '@expo/vector-icons';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
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

import { latestReadyFile, useProjectDocuments } from '@/features/projects/queries';
import { humanize } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { colors, radii } from '@/theme';

export default function ProjectDocumentsScreen() {
  const router = useRouter();
  const { tokens } = useAuth();
  const params = useLocalSearchParams<{ projectId: string; name?: string }>();
  const projectId = params.projectId;
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch, isRefetching } = useProjectDocuments(projectId ?? '');

  if (tokens === null) {
    return <Redirect href="/login" />;
  }
  if (projectId === undefined || projectId === '') {
    return <Redirect href="/projects" />;
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: params.name ?? 'Documents' }} />
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>Couldn’t load documents.</Text>
          <Pressable style={styles.retry} onPress={() => { void refetch(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} />
          }
          ListEmptyComponent={
            <View style={styles.centered}><Text style={styles.muted}>No documents in this project.</Text></View>
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
                    {humanize(item.discipline)}{disabled ? ' · processing…' : ''}
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
      )}

      {/* Add a snag without opening the model. Pins-from-viewer add anchored
          findings; this entry point creates an unanchored one (all link/anchor
          fields null — the create form and API both allow it). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add snag"
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

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
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
