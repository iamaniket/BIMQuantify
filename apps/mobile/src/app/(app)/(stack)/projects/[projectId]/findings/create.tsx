import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useT } from '@/i18n';
import { useCreateFindingMutation } from '@/features/findings/queries';
import { PhotoStrip } from '@/features/photos/PhotoStrip';
import { usePhotoCapture } from '@/features/photos/usePhotoCapture';
import type { FindingSeverityValue } from '@/lib/api/schemas/findings';
import { useAuth } from '@/providers/AuthProvider';
import { colors, radii } from '@/theme';

const SEVERITIES: FindingSeverityValue[] = ['low', 'medium', 'high'];

function severityColor(s: FindingSeverityValue): string {
  switch (s) {
    case 'high': return colors.error;
    case 'medium': return colors.warning;
    default: return colors.info;
  }
}

export default function FindingCreateScreen() {
  const router = useRouter();
  const { t } = useT();
  const { tokens } = useAuth();
  const params = useLocalSearchParams<{
    projectId: string;
    modelId?: string;
    fileId?: string;
    fileType?: string;
    anchorX?: string;
    anchorY?: string;
    anchorZ?: string;
    anchorPage?: string;
  }>();
  const projectId = params.projectId;
  const mutation = useCreateFindingMutation(projectId ?? '');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FindingSeverityValue>('medium');
  const photos = usePhotoCapture(projectId ?? '');

  const anchorX = params.anchorX != null ? parseFloat(params.anchorX) : null;
  const anchorY = params.anchorY != null ? parseFloat(params.anchorY) : null;
  const anchorZ = params.anchorZ != null ? parseFloat(params.anchorZ) : null;
  const anchorPage = params.anchorPage != null ? parseInt(params.anchorPage, 10) : null;
  const fileType = params.fileType as 'ifc' | 'pdf' | undefined;
  const hasPinFromViewer = anchorX != null && anchorY != null && fileType != null;

  const handleSave = useCallback(() => {
    if (!title.trim()) {
      Alert.alert(t('findings.create.titleRequired'), t('findings.create.titleRequiredBody'));
      return;
    }
    if (!description.trim()) {
      Alert.alert(t('findings.create.descriptionRequired'), t('findings.create.descriptionRequiredBody'));
      return;
    }

    const photoIds = photos.photoIds();
    mutation.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        severity,
        linked_document_id: params.modelId ?? null,
        linked_file_id: params.fileId ?? null,
        linked_file_type: fileType ?? null,
        anchor_x: anchorX,
        anchor_y: anchorY,
        anchor_z: anchorZ,
        anchor_page: anchorPage,
        photo_ids: photoIds.length > 0 ? photoIds : null,
      },
      {
        onSuccess: () => { router.back(); },
        onError: (err) => {
          Alert.alert(t('common.error'), err.message);
        },
      },
    );
  }, [title, description, severity, params, fileType, anchorX, anchorY, anchorZ, photos, mutation, router, t]);

  if (tokens === null) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/projects" />;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: t('findings.create.title') }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={100}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Pin indicator */}
          {hasPinFromViewer ? (
            <View style={styles.pinBanner}>
              <Text style={styles.pinIcon}>📍</Text>
              <Text style={styles.pinText}>
                {fileType === 'pdf' && anchorPage != null
                  ? t('findings.create.pinnedPdf', { page: anchorPage })
                  : t('findings.create.pinned3d', {
                      coords: `${anchorX!.toFixed(1)}, ${anchorY!.toFixed(1)}, ${anchorZ?.toFixed(1) ?? '–'}`,
                    })}
              </Text>
            </View>
          ) : null}

          {/* Title */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('findings.create.titleLabel')}</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder={t('findings.create.titlePlaceholder')}
              placeholderTextColor={colors.placeholder}
              maxLength={255}
              returnKeyType="next"
            />
          </View>

          {/* Description */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('findings.create.descriptionLabel')}</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('findings.create.descriptionPlaceholder')}
              placeholderTextColor={colors.placeholder}
              maxLength={4000}
              multiline
              textAlignVertical="top"
            />
          </View>

          {/* Severity */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('findings.create.severityLabel')}</Text>
            <View style={styles.segmented}>
              {SEVERITIES.map((s) => {
                const active = s === severity;
                return (
                  <Pressable
                    key={s}
                    style={[
                      styles.segment,
                      active && { backgroundColor: severityColor(s) },
                    ]}
                    onPress={() => { setSeverity(s); }}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {t(`findings.severity.${s}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Photos */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('findings.create.photosLabel')}</Text>
            <PhotoStrip photos={photos.photos} onAdd={photos.add} onRemove={photos.remove} />
          </View>

          {/* Save */}
          <Pressable
            style={[styles.saveBtn, (mutation.isPending || photos.isBusy) && styles.saveBtnDisabled]}
            disabled={mutation.isPending || photos.isBusy}
            onPress={handleSave}
          >
            {mutation.isPending ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>{t('findings.create.save')}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 20, gap: 20, maxWidth: 760, width: '100%', alignSelf: 'center' },
  pinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.primaryLight,
  },
  pinIcon: { fontSize: 16 },
  pinText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
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
  multiline: { minHeight: 100, paddingTop: 12 },
  segmented: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  segmentTextActive: { color: '#ffffff' },
  saveBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
});
