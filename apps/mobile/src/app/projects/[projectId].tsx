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

import { latestReadyFile, useProjectModels } from '@/features/projects/queries';
import { humanize } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';

export default function ProjectModelsScreen() {
  const router = useRouter();
  const { tokens } = useAuth();
  const params = useLocalSearchParams<{ projectId: string; name?: string }>();
  const projectId = params.projectId;
  const { data, isLoading, isError, refetch, isRefetching } = useProjectModels(projectId ?? '');

  if (tokens === null) {
    return <Redirect href="/login" />;
  }
  if (projectId === undefined || projectId === '') {
    return <Redirect href="/projects" />;
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ headerShown: true, title: params.name ?? 'Models' }} />
      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator /></View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>Couldn’t load models.</Text>
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
            <View style={styles.centered}><Text style={styles.muted}>No models in this project.</Text></View>
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
                {disabled ? <ActivityIndicator size="small" /> : <Text style={styles.chevron}>›</Text>}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { fontSize: 15, opacity: 0.6 },
  retry: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#208AEF' },
  retryText: { color: '#fff', fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingVertical: 16, gap: 10, maxWidth: 760, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e1e5ea',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowDisabled: { opacity: 0.5 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  rowSub: { fontSize: 14, opacity: 0.6, marginTop: 2 },
  chevron: { fontSize: 26, opacity: 0.35, fontWeight: '300' },
});
