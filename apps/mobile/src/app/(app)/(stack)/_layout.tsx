import { Stack } from 'expo-router';
import { View } from 'react-native';

import { HeaderMenuButton } from '@/components/HeaderMenuButton';
import { OfflineBanner } from '@/components/offline/OfflineBanner';
import { SyncStatusChip } from '@/components/offline/SyncStatusChip';
import { colors } from '@/theme';

/** Stack inside the drawer — primary app-bar across the authenticated screens.
 * Wrapped so the offline banner overlays every authenticated screen. */
export default function AppStackLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.onPrimary,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {/* Projects renders its own blue gradient header + bottom nav (design CompactHeader). */}
        <Stack.Screen name="projects/index" options={{ headerShown: false }} />
        {/* Settings is reached from the drawer, so it keeps the hamburger to reopen it. */}
        <Stack.Screen
          name="settings"
          options={{ title: 'Settings', headerLeft: () => <HeaderMenuButton /> }}
        />
      </Stack>
      <SyncStatusChip />
      <OfflineBanner />
    </View>
  );
}
