import { Stack } from 'expo-router';

import { HeaderMenuButton } from '@/components/HeaderMenuButton';
import { colors } from '@/theme';

/** Stack inside the drawer — primary app-bar across the authenticated screens. */
export default function AppStackLayout() {
  return (
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
  );
}
