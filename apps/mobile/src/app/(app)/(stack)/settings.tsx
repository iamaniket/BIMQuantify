import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

/** Placeholder — a real settings/profile screen lands later. */
export default function SettingsScreen() {
  return (
    <View style={styles.root}>
      <Ionicons name="construct-outline" size={40} color={colors.textMuted} />
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.muted}>Coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.background,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  muted: { fontSize: 15, color: colors.textMuted },
});
