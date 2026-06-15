import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Phase C replaces this with the embedded viewer WebView. For now it proves the
 * full navigation chain and surfaces the exact IDs the viewer bridge will need.
 */
export default function ViewerStubScreen() {
  const { projectId, modelId, fileId } = useLocalSearchParams<{
    projectId: string;
    modelId: string;
    fileId: string;
  }>();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Viewer' }} />
      <Text style={styles.title}>Viewer (Phase C)</Text>
      <Text style={styles.muted}>The 3D model + findings WebView lands here.</Text>
      <View style={styles.params}>
        <Text style={styles.param}>project: {projectId}</Text>
        <Text style={styles.param}>model: {modelId}</Text>
        <Text style={styles.param}>file: {fileId}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  title: { fontSize: 22, fontWeight: '700' },
  muted: { fontSize: 15, opacity: 0.6, textAlign: 'center' },
  params: { marginTop: 16, gap: 4, alignItems: 'center' },
  param: { fontSize: 13, opacity: 0.8 },
});
