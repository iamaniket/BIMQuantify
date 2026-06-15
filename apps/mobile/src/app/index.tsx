import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/providers/AuthProvider';

/** Auth gate: route to login, org-select, or the project list. */
export default function Index() {
  const { hasHydrated, tokens, me } = useAuth();

  if (!hasHydrated || (tokens !== null && me === null)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (tokens === null) {
    return <Redirect href="/login" />;
  }

  if (me !== null && me.active_organization_id === null && me.memberships.length > 0) {
    return <Redirect href="/select-org" />;
  }

  return <Redirect href="/projects" />;
}
