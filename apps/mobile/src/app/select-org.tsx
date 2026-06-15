import { Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/providers/AuthProvider';
import { colors, radii } from '@/theme';

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
            <View style={styles.orgIcon}>
              <Ionicons name="business-outline" size={18} color={colors.primary} />
            </View>
            <Text style={styles.rowTitle} numberOfLines={1}>{item.organization_name}</Text>
            {switching === item.organization_id ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            )}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 24, paddingTop: 24, gap: 6 },
  heading: { fontSize: 24, fontWeight: '700', color: colors.text },
  muted: { fontSize: 15, color: colors.textMuted },
  error: { color: colors.error, fontSize: 14, paddingHorizontal: 24, paddingTop: 12 },
  list: { padding: 16, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: colors.surface,
  },
  orgIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  rowTitle: { flex: 1, fontSize: 17, fontWeight: '500', color: colors.text },
});
