import { Drawer } from 'expo-router/drawer';

import { AppSidebar } from '@/components/AppSidebar';
import { useLayoutKind } from '@/features/projects/useLayoutKind';
import { colors } from '@/theme';

/**
 * Authenticated area. A Drawer hosts the primary-coloured sidebar; the nested
 * (stack) group provides the per-screen header + push/back navigation. Route
 * groups don't affect URLs, so /projects and /projects/[projectId] are unchanged.
 *
 * Responsive: on landscape tablets the drawer is `permanent` (the design's docked
 * sidebar — always visible); elsewhere it slides in from the left with edge-swipe.
 */
export default function AppDrawerLayout() {
  const layout = useLayoutKind();
  const docked = layout === 'tabletLandscape';
  const width = docked ? 280 : layout === 'tabletPortrait' ? 320 : 288;

  return (
    <Drawer
      drawerContent={(props) => <AppSidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: docked ? 'permanent' : 'front',
        swipeEnabled: !docked,
        swipeEdgeWidth: 50,
        drawerStyle: { backgroundColor: colors.primary, width, borderRightWidth: 0 },
      }}
    />
  );
}
