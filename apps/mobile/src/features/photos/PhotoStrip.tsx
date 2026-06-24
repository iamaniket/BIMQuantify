import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radii } from '@/theme';

import type { CaptureSource } from './capture';
import type { PhotoItem } from './usePhotoCapture';

type Props = {
  photos: PhotoItem[];
  onAdd: (source: CaptureSource) => void;
  onRemove: (localId: string) => void;
};

/** Horizontal strip of photo thumbnails + an add button (camera / library). */
export function PhotoStrip({ photos, onAdd, onRemove }: Props) {
  const promptAdd = (): void => {
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: () => { onAdd('camera'); } },
      { text: 'Choose from library', onPress: () => { onAdd('library'); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {photos.map((p) => (
        <View key={p.localId} style={styles.thumb}>
          <Image source={{ uri: p.thumbnailUri }} style={styles.img} contentFit="cover" />
          {p.status === 'uploading' ? (
            <View style={styles.overlay}>
              <ActivityIndicator color="#ffffff" size="small" />
            </View>
          ) : null}
          {p.status === 'error' ? (
            <View style={[styles.overlay, styles.errorOverlay]}>
              <Text style={styles.errorMark}>!</Text>
            </View>
          ) : null}
          {p.status === 'queued' ? (
            <View style={styles.queuedBadge}>
              <Text style={styles.queuedText}>Queued</Text>
            </View>
          ) : null}
          <Pressable style={styles.removeBtn} onPress={() => { onRemove(p.localId); }} hitSlop={8}>
            <Text style={styles.removeText}>×</Text>
          </Pressable>
        </View>
      ))}
      <Pressable style={styles.addBtn} onPress={promptAdd}>
        <Text style={styles.addPlus}>＋</Text>
        <Text style={styles.addLabel}>Photo</Text>
      </Pressable>
    </ScrollView>
  );
}

const THUMB = 72;

const styles = StyleSheet.create({
  row: { gap: 10, paddingVertical: 2 },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  img: { width: '100%', height: '100%' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  errorOverlay: { backgroundColor: 'rgba(180,30,30,0.55)' },
  errorMark: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  queuedBadge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 2,
    backgroundColor: 'rgba(51,65,85,0.85)',
  },
  queuedText: { color: '#ffffff', fontSize: 9, fontWeight: '700', textAlign: 'center' },
  removeBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  removeText: { color: '#ffffff', fontSize: 15, fontWeight: '700', lineHeight: 17 },
  addBtn: {
    width: THUMB,
    height: THUMB,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: colors.surface,
  },
  addPlus: { fontSize: 20, color: colors.primary, fontWeight: '700' },
  addLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
});
