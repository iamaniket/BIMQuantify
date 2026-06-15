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
      {/* Stack root gets the hamburger; pushed screens keep the default back arrow. */}
      <Stack.Screen
        name="projects/index"
        options={{ title: 'Projects', headerLeft: () => <HeaderMenuButton /> }}
      />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}
