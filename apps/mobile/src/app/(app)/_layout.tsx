import { Drawer } from 'expo-router/drawer';

import { AppSidebar } from '@/components/AppSidebar';
import { colors } from '@/theme';

/**
 * Authenticated area. A Drawer hosts the primary-coloured sidebar; the nested
 * (stack) group provides the per-screen header + push/back navigation. Route
 * groups don't affect URLs, so /projects and /projects/[projectId] are unchanged.
 */
export default function AppDrawerLayout() {
  return (
    <Drawer
      drawerContent={(props) => <AppSidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { backgroundColor: colors.primary, width: 300 },
      }}
    />
  );
}
