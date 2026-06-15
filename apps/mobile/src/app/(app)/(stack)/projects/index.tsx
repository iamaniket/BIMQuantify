import { Redirect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useProjects } from '@/features/projects/queries';
import { humanize } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { colors, projectStatusColor, radii } from '@/theme';

export default function ProjectsScreen() {
  const router = useRouter();
  const { tokens } = useAuth();
  const { data, isLoading, isError, refetch, isRefetching } = useProjects();

  if (tokens === null) {
    return <Redirect href="/login" />;
  }

  // Header (title + org + log out) now lives in the primary app-bar and sidebar.
  return (
    <View style={styles.flex}>
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>Couldn’t load projects.</Text>
          <Pressable style={styles.retry} onPress={() => { void refetch(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} />
          }
          ListEmptyComponent={
            <View style={styles.centered}><Text style={styles.muted}>No projects yet.</Text></View>
          }
          renderItem={({ item }) => {
            const subtitle = [item.reference_code, item.city]
              .filter((x) => x != null && x !== '')
              .join(' · ');
            return (
              <Pressable
                style={styles.row}
                onPress={() => router.push({
                  pathname: '/projects/[projectId]',
                  params: { projectId: item.id, name: item.name },
                })}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
                  {subtitle.length > 0 ? (
                    <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text>
                  ) : null}
                </View>
                <View style={[styles.chip, { backgroundColor: projectStatusColor(item.status) }]}>
                  <Text style={styles.chipText}>{humanize(item.status)}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
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
  rowText: { flex: 1 },
  rowTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  chipText: { color: colors.onPrimary, fontSize: 12, fontWeight: '600' },
});
