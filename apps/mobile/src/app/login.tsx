import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Linking, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Kpi } from '@/features/auth/brandParts';
import type { LoginFormProps } from '@/features/auth/LoginForm';
import {
  MobileLogin,
  TabletLandscapeLogin,
  TabletPortraitLogin,
  type LoginLayoutProps,
} from '@/features/auth/loginLayouts';
import { useProjectsMap } from '@/features/auth/useProjectsMap';
import { useSystemStatus } from '@/features/auth/useSystemStatus';
import { useT } from '@/i18n';
import { login } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { env } from '@/lib/env';
import { useAuth } from '@/providers/AuthProvider';
import { brand, colors } from '@/theme';

// Tablet-class when the shortest side is >= 600 dp; landscape when wider than
// tall. Recomputes on rotation (useWindowDimensions), so the layout switches
// live between the phone / tablet-portrait / tablet-landscape designs.
const TABLET_MIN_SIDE = 600;

export default function LoginScreen() {
  const router = useRouter();
  const { t, locale } = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { setTokens } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live brand-canvas data from the public (unauthenticated) login endpoints.
  const projectsQuery = useProjectsMap();
  const systemQuery = useSystemStatus();

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  async function onSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const pair = await login(email.trim(), password);
      setTokens(pair);
      // The index gate re-evaluates auth state and routes onward (or to org select).
      router.replace('/');
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 400
          ? t('login.error.invalidCredentials')
          : t('login.error.signInFailed', { message: e instanceof Error ? e.message : String(e) }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Live system status → KPI strip + status row, falling back to the design's
  // static values when the endpoint is loading/unreachable.
  const sys = systemQuery.data;
  const status = sys?.status;
  const wkb = sys?.wkb_version ?? '2026.1';
  const kpiItems: Kpi[] = [
    { label: 'WKB', value: wkb },
    { label: 'BBL', value: sys?.bbl_version ?? 'v2026.04' },
    { label: 'IFC', value: sys?.ifc_version ?? '4.3' },
    {
      label: 'STATUS',
      value:
        status === 'degraded'
          ? t('login.status.degraded')
          : status === 'down'
            ? t('login.status.down')
            : t('login.status.normal'),
      valueColor:
        status === 'down' ? colors.error : status === 'degraded' ? colors.warning : brand.mint,
    },
  ];
  const statusColor =
    status === 'down' ? colors.error : status === 'degraded' ? colors.warning : colors.success;
  const statusLabel =
    status === 'down'
      ? t('login.statusRow.disruption')
      : status === 'degraded'
        ? t('login.statusRow.degraded')
        : t('login.statusRow.normal');

  // The mobile app has no forgot-password / request-access screens (sign-in is
  // invite-only), so those links open the web portal in the app's language.
  const webBase = `${env.EXPO_PUBLIC_WEB_URL}/${locale}`;

  const form: LoginFormProps = {
    email,
    password,
    onChangeEmail: setEmail,
    onChangePassword: setPassword,
    showPassword,
    onToggleShow: () => setShowPassword((v) => !v),
    submitting,
    error,
    canSubmit,
    onSubmit: () => {
      void onSubmit();
    },
    onForgot: () => {
      void Linking.openURL(`${webBase}/forgot-password`);
    },
    onRequestAccess: () => {
      void Linking.openURL(`${webBase}/request-access`);
    },
  };

  const layoutProps: LoginLayoutProps = {
    form,
    markers: projectsQuery.data ?? [],
    kpiItems,
    statusColor,
    statusLabel,
    wkb,
    webBaseUrl: webBase,
    insets,
  };

  const isLandscape = width > height;
  const isTablet = Math.min(width, height) >= TABLET_MIN_SIDE;

  return (
    <View style={{ flex: 1, backgroundColor: brand.surfacePage }}>
      {/* White status-bar content — it sits over the dark-blue hero. */}
      <StatusBar style="light" />
      {isTablet && isLandscape ? (
        <TabletLandscapeLogin {...layoutProps} />
      ) : isTablet ? (
        <TabletPortraitLogin {...layoutProps} />
      ) : (
        <MobileLogin {...layoutProps} />
      )}
      {__DEV__ ? (
        <Text
          style={{
            position: 'absolute',
            top: insets.top + 2,
            right: 8,
            fontSize: 9,
            color: 'rgba(255,255,255,0.5)',
          }}
        >
          API: {env.EXPO_PUBLIC_API_URL}
        </Text>
      ) : null}
    </View>
  );
}
