import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/providers/AuthProvider';

export default function SelectOrgScreen() {
  const router = useRouter();
  const { tokens, me, switchOrganization } = useAuth();
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (tokens === null) {
    return <Redirect href="/login" />;
  }

  async function pick(organizationId: string) {
    setError(null);
    setSwitching(organizationId);
    try {
      await switchOrganization(organizationId);
      router.replace('/');
    } catch {
      setError('Could not switch organization. Try again.');
      setSwitching(null);
    }
  }

  const memberships = me?.memberships ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.heading}>Choose an organization</Text>
        <Text style={styles.muted}>You belong to more than one. Pick one to continue.</Text>
      </View>
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={memberships}
        keyExtractor={(m) => m.organization_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            disabled={switching !== null}
            onPress={() => { void pick(item.organization_id); }}
          >
            <Text style={styles.rowTitle}>{item.organization_name}</Text>
            {switching === item.organization_id ? <ActivityIndicator /> : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 24, gap: 6 },
  heading: { fontSize: 24, fontWeight: '700' },
  muted: { fontSize: 15, opacity: 0.7 },
  error: { color: '#d23f3f', fontSize: 14, paddingHorizontal: 24, paddingTop: 12 },
  list: { padding: 16, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e1e5ea',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  rowTitle: { fontSize: 17, fontWeight: '500' },
});
