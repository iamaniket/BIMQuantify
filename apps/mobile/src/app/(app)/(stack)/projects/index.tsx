import { useDrawerStatus } from '@react-navigation/drawer';
import { Redirect, useNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomNav } from '@/features/projects/BottomNav';
import { ProjectCard } from '@/features/projects/ProjectCard';
import { ProjectCoverCard } from '@/features/projects/ProjectCoverCard';
import { ProjectsHeader } from '@/features/projects/ProjectsHeader';
import { ProjectsToolbar } from '@/features/projects/ProjectsToolbar';
import { StatStrip } from '@/features/projects/StatStrip';
import { projectCounts } from '@/features/projects/projectStats';
import { useProjects } from '@/features/projects/queries';
import { useLayoutKind } from '@/features/projects/useLayoutKind';
import type { Project } from '@/lib/api/schemas/projects';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme';

export default function ProjectsScreen() {
  const navigation = useNavigation();
  const layout = useLayoutKind();
  const drawerStatus = useDrawerStatus();
  const { tokens } = useAuth();
  const { data, isLoading, isError, refetch, isRefetching } = useProjects();

  const [query, setQuery] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

  const openDrawer = useCallback(() => {
    navigation.dispatch({ type: 'OPEN_DRAWER' });
  }, [navigation]);

  const all = useMemo<Project[]>(() => data ?? [], [data]);
  const counts = useMemo(() => projectCounts(all), [all]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((p) => {
      if (activeOnly && p.lifecycle_state === 'archived') return false;
      if (q.length === 0) return true;
      return [p.name, p.city, p.reference_code]
        .filter((x): x is string => x != null && x !== '')
        .some((x) => x.toLowerCase().includes(q));
    });
  }, [all, query, activeOnly]);

  if (tokens === null) {
    return <Redirect href="/login" />;
  }

  type Spacer = { id: string; spacer: true };
  const isSpacer = (it: Project | Spacer): it is Spacer => 'spacer' in it;

  const isPhone = layout === 'phone';
  const numColumns = isPhone ? 1 : layout === 'tabletPortrait' ? 2 : 3;
  const showBottomNav = layout !== 'tabletLandscape';
  const showStats = layout !== 'phone';
  const hPad = isPhone ? 16 : layout === 'tabletPortrait' ? 34 : 30;
  const gap = isPhone ? 11 : 18;

  // Pad the last grid row so a lone card keeps its column width instead of stretching.
  const remainder = numColumns > 1 ? visible.length % numColumns : 0;
  const gridData: (Project | Spacer)[] =
    remainder === 0
      ? visible
      : [
          ...visible,
          ...Array.from({ length: numColumns - remainder }, (_, i): Spacer => ({ id: `spacer-${i}`, spacer: true })),
        ];

  const listHeader = (
    <View style={{ gap: showStats ? 18 : 14, marginBottom: gap }}>
      {showStats ? <StatStrip counts={counts} cols={4} /> : null}
      <ProjectsToolbar
        query={query}
        onQueryChange={setQuery}
        activeOnly={activeOnly}
        onToggleActiveOnly={() => setActiveOnly((v) => !v)}
        count={visible.length}
      />
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ProjectsHeader
        layout={layout}
        activeCount={counts.active}
        archivedCount={counts.archived}
        onOpenDrawer={openDrawer}
      />

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
          key={`cols-${numColumns}`}
          data={gridData}
          keyExtractor={(p) => p.id}
          numColumns={numColumns}
          columnWrapperStyle={numColumns > 1 ? { gap } : undefined}
          ItemSeparatorComponent={() => <View style={{ height: gap }} />}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ paddingHorizontal: hPad, paddingTop: 14, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.muted}>{query.length > 0 || activeOnly ? 'No matching projects.' : 'No projects yet.'}</Text>
            </View>
          }
          renderItem={({ item }) => {
            if (isSpacer(item)) return <View style={styles.gridCell} />;
            return isPhone ? (
              <ProjectCard project={item} />
            ) : (
              <View style={styles.gridCell}>
                <ProjectCoverCard project={item} />
              </View>
            );
          }}
        />
      )}

      {showBottomNav ? (
        <BottomNav onMenu={openDrawer} menuOpen={drawerStatus === 'open'} projectsCount={counts.active} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceLow },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 48 },
  muted: { fontSize: 15, color: colors.textMuted },
  retry: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, backgroundColor: colors.primary },
  retryText: { color: colors.onPrimary, fontWeight: '600' },
  // Cover cards stretch to fill their grid column evenly.
  gridCell: { flex: 1 },
});
