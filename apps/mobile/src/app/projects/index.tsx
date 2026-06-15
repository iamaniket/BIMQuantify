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
import { SafeAreaView } from 'react-native-safe-area-context';

import { useProjects } from '@/features/projects/queries';
import { humanize } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';

const STATUS_COLORS: Record<string, string> = {
  planning: '#6b7280',
  design: '#208AEF',
  permit_review: '#a855f7',
  construction: '#f59e0b',
  handover: '#10b981',
  complete: '#16a34a',
  on_hold: '#ef4444',
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#6b7280';
}

export default function ProjectsScreen() {
  const router = useRouter();
  const { tokens, activeMembership, setTokens } = useAuth();
  const { data, isLoading, isError, refetch, isRefetching } = useProjects();

  if (tokens === null) {
    return <Redirect href="/login" />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Projects</Text>
          {activeMembership !== null ? (
            <Text style={styles.org} numberOfLines={1}>{activeMembership.organization_name}</Text>
          ) : null}
        </View>
        <Pressable onPress={() => { setTokens(null); }} hitSlop={8}>
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator /></View>
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
                <View style={[styles.chip, { backgroundColor: statusColor(item.status) }]}>
                  <Text style={styles.chipText}>{humanize(item.status)}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  headerText: { flex: 1 },
  title: { fontSize: 26, fontWeight: '700' },
  org: { fontSize: 14, opacity: 0.6, marginTop: 2 },
  logout: { color: '#208AEF', fontWeight: '600', fontSize: 15 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { fontSize: 15, opacity: 0.6 },
  retry: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#208AEF' },
  retryText: { color: '#fff', fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10, maxWidth: 760, width: '100%', alignSelf: 'center' },
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
  rowText: { flex: 1 },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  rowSub: { fontSize: 14, opacity: 0.6, marginTop: 2 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
