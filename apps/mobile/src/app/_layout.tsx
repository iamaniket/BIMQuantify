import {
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_500Medium_Italic,
  Fraunces_600SemiBold,
  useFonts,
} from '@expo-google-fonts/fraunces';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { I18nProvider } from '@/i18n';
import { AuthProvider } from '@/providers/AuthProvider';
import { OfflineProvider } from '@/providers/OfflineProvider';
import { QueryProvider } from '@/providers/QueryProvider';

// Hold the native splash until Fraunces (the auth-screen display serif) is
// ready, so the login headline never flashes in a fallback font on first paint.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_500Medium_Italic,
    Fraunces_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError !== null) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Render nothing while fonts load (splash stays up). Failure still proceeds —
  // RN falls back to the system serif rather than blocking sign-in.
  if (!fontsLoaded && fontError === null) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryProvider>
          <AuthProvider>
            <OfflineProvider>
              <I18nProvider>
                <Stack screenOptions={{ headerShown: false }} />
                <StatusBar style="auto" />
              </I18nProvider>
            </OfflineProvider>
          </AuthProvider>
        </QueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
