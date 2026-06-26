import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useNetworkStatus } from '@/lib/offline/networkStatus';
import { useAuth } from '@/providers/AuthProvider';

/** Auth gate: route to login, org-select, or the project list. Offline-tolerant —
 * a previously-authenticated user lands on the (cached) project list rather than
 * hanging on a spinner waiting for a /auth/me call that can't complete. */
export default function Index() {
  const { hasHydrated, tokens, me } = useAuth();
  const online = useNetworkStatus();

  // Block only while restoring tokens + cached `me` from storage.
  if (!hasHydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (tokens === null) {
    return <Redirect href="/login" />;
  }

  if (me !== null) {
    // Org-select needs a network call (switchOrganization), so only route there
    // when online; a returning user's cached `me` already has an active org.
    if (me.active_organization_id === null && me.memberships.length > 0 && online) {
      return <Redirect href="/select-org" />;
    }
    return <Redirect href="/projects" />;
  }

  // Session present but `me` not yet resolved. Online: /auth/me is in flight and
  // resolves fast — show the spinner. Offline: best-effort into the app; the
  // access token carries the org claim, so the cached project list still works.
  if (online) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href="/projects" />;
}
