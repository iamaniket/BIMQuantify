import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useT } from '@/i18n';
import { PhotoStrip } from '@/features/photos/PhotoStrip';
import { usePhotoCapture } from '@/features/photos/usePhotoCapture';
import { colors, radii } from '@/theme';

type Props = {
  visible: boolean;
  projectId: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (args: { note: string; evidenceIds: string[] }) => void;
};

/**
 * Bottom sheet to resolve a finding: a required note + at least one evidence
 * photo (mirrors the server's FINDING_RESOLVE_REQUIRES_EVIDENCE gate). Reuses the
 * same photo capture/upload pipeline as creating a finding, so evidence photos
 * queue offline and resolve their temp ids on sync just like snag photos.
 */
export function ResolveSheet({ visible, projectId, pending, onCancel, onSubmit }: Props) {
  const { t } = useT();
  const photos = usePhotoCapture(projectId);
  const [note, setNote] = useState('');

  const handleSubmit = (): void => {
    if (!note.trim()) {
      Alert.alert(t('findings.resolve.title'), t('findings.resolve.noteRequired'));
      return;
    }
    const evidenceIds = photos.photoIds();
    if (evidenceIds.length === 0) {
      Alert.alert(t('findings.resolve.title'), t('findings.resolve.evidenceRequired'));
      return;
    }
    onSubmit({ note: note.trim(), evidenceIds });
  };

  const busy = pending || photos.isBusy;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <Text style={styles.title}>{t('findings.resolve.title')}</Text>
            <Text style={styles.hint}>{t('findings.resolve.hint')}</Text>

            <Text style={styles.label}>{t('findings.resolve.noteLabel')}</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={note}
              onChangeText={setNote}
              placeholder={t('findings.resolve.notePlaceholder')}
              placeholderTextColor={colors.placeholder}
              maxLength={4000}
              multiline
              textAlignVertical="top"
            />

            <Text style={styles.label}>{t('findings.resolve.evidenceLabel')}</Text>
            <PhotoStrip photos={photos.photos} onAdd={photos.add} onRemove={photos.remove} />

            <View style={styles.actions}>
              <Pressable style={styles.cancelBtn} onPress={onCancel} disabled={busy}>
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.submitBtn, busy && styles.submitDisabled]}
                onPress={handleSubmit}
                disabled={busy}
              >
                {pending ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={styles.submitText}>{t('findings.resolve.submit')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: 20,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  hint: { fontSize: 13, color: colors.textMuted },
  label: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  multiline: { minHeight: 90, paddingTop: 12 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancelText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  submitBtn: {
    flex: 2,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.success,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
});
