import { Image } from 'expo-image';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useT } from '@/i18n';
import { PromoteSheet } from '@/features/findings/PromoteSheet';
import { ResolveSheet } from '@/features/findings/ResolveSheet';
import { severityColor, statusColor } from '@/features/findings/findingStyle';
import { useFinding, useUpdateFindingMutation } from '@/features/findings/queries';
import { useAttachmentUrls } from '@/features/findings/useAttachmentUrls';
import { useProject } from '@/features/projects/queries';
import type { Finding, FindingUpdateInput } from '@/lib/api/schemas/findings';
import { formatShortDate } from '@/lib/format';
import { useNetworkStatus } from '@/lib/offline/networkStatus';
import { useAuth } from '@/providers/AuthProvider';
import { colors, radii } from '@/theme';

export default function FindingDetailScreen() {
  const router = useRouter();
  const { t } = useT();
  const { tokens, me } = useAuth();
  const { projectId, findingId } = useLocalSearchParams<{
    projectId: string;
    findingId: string;
  }>();
  const { data: finding, isLoading, isError, refetch } = useFinding(
    projectId ?? '',
    findingId ?? '',
  );
  const project = useProject(projectId ?? '');
  const update = useUpdateFindingMutation(projectId ?? '');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);

  const isInspector = project.data?.my_role === 'inspector';

  const runUpdate = useCallback(
    (input: FindingUpdateInput, onDone?: () => void): void => {
      if (!finding) return;
      update.mutate(
        { finding, input },
        {
          onSuccess: () => { onDone?.(); },
          onError: () => { Alert.alert(t('common.error'), t('findings.actions.updateError')); },
        },
      );
    },
    [finding, update, t],
  );

  if (tokens === null) return <Redirect href="/login" />;
  if (!projectId || !findingId) return <Redirect href="/projects" />;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: finding?.title ?? t('findings.detail.fallbackTitle') }} />

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError || !finding ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>{t('findings.detail.loadError')}</Text>
          <Pressable style={styles.retry} onPress={() => { void refetch(); }}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            {/* Status + Severity badges */}
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: statusColor(finding.status) }]}>
                <Text style={styles.badgeText}>{t(`findings.status.${finding.status}`)}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: severityColor(finding.severity) }]}>
                <Text style={styles.badgeText}>{t(`findings.severity.${finding.severity}`)}</Text>
              </View>
            </View>

            <Text style={styles.title}>{finding.title}</Text>
            <Text style={styles.description}>{finding.description}</Text>

            {/* Metadata */}
            <View style={styles.section}>
              {finding.bbl_article_ref ? (
                <MetaRow label={t('findings.detail.bblArticle')} value={finding.bbl_article_ref} />
              ) : null}
              {finding.deadline_date ? (
                <MetaRow label={t('findings.detail.deadline')} value={formatShortDate(finding.deadline_date)} />
              ) : null}
              {finding.linked_file_type ? (
                <MetaRow label={t('findings.detail.anchor')} value={anchorSummary(finding, t)} />
              ) : null}
            </View>

            {/* Photos */}
            {finding.photo_ids && finding.photo_ids.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('findings.detail.photos')}</Text>
                <PhotoGallery projectId={projectId} ids={finding.photo_ids} />
              </View>
            ) : null}

            {/* Resolution */}
            {finding.resolution_note ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('findings.detail.resolution')}</Text>
                <Text style={styles.description}>{finding.resolution_note}</Text>
                {finding.resolution_evidence_ids && finding.resolution_evidence_ids.length > 0 ? (
                  <>
                    <Text style={styles.subLabel}>{t('findings.detail.resolutionEvidence')}</Text>
                    <PhotoGallery projectId={projectId} ids={finding.resolution_evidence_ids} />
                  </>
                ) : null}
              </View>
            ) : null}

            {/* Navigate to viewer if pinned on IFC model */}
            {finding.linked_file_type === 'ifc' && finding.linked_document_id && finding.linked_file_id ? (
              <Pressable
                style={styles.viewBtn}
                onPress={() => {
                  router.push({
                    pathname: '/viewer/[projectId]/[modelId]/[fileId]',
                    params: {
                      projectId,
                      modelId: finding.linked_document_id!,
                      fileId: finding.linked_file_id!,
                    },
                  });
                }}
              >
                <Text style={styles.viewBtnText}>{t('findings.detail.viewIn3d')}</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          {/* Lifecycle action bar */}
          <ActionBar
            finding={finding}
            isInspector={isInspector}
            pending={update.isPending}
            onPromote={() => { setPromoteOpen(true); }}
            onStartWork={() => { runUpdate({ status: 'in_progress' }); }}
            onResolve={() => { setResolveOpen(true); }}
            onReopen={() => { runUpdate({ status: 'open' }); }}
            onVerify={() => { runUpdate({ status: 'verified' }); }}
            onRework={() => { runUpdate({ status: 'in_progress' }); }}
          />

          <PromoteSheet
            visible={promoteOpen}
            pending={update.isPending}
            onCancel={() => { setPromoteOpen(false); }}
            onSubmit={(deadlineDate) => {
              runUpdate(
                { status: 'open', assignee_user_id: me?.user.id ?? null, deadline_date: deadlineDate },
                () => { setPromoteOpen(false); },
              );
            }}
          />
          <ResolveSheet
            visible={resolveOpen}
            projectId={projectId}
            pending={update.isPending}
            onCancel={() => { setResolveOpen(false); }}
            onSubmit={({ note, evidenceIds }) => {
              runUpdate(
                { status: 'resolved', resolution_note: note, resolution_evidence_ids: evidenceIds },
                () => { setResolveOpen(false); },
              );
            }}
          />
        </>
      )}
    </View>
  );
}

/** Status- and role-aware buttons derived from the server's legal transition map. */
function ActionBar({
  finding,
  isInspector,
  pending,
  onPromote,
  onStartWork,
  onResolve,
  onReopen,
  onVerify,
  onRework,
}: {
  finding: Finding;
  isInspector: boolean;
  pending: boolean;
  onPromote: () => void;
  onStartWork: () => void;
  onResolve: () => void;
  onReopen: () => void;
  onVerify: () => void;
  onRework: () => void;
}) {
  const { t } = useT();

  let buttons: { key: string; label: string; tone: 'primary' | 'success' | 'outline'; onPress: () => void }[] = [];
  let note: string | null = null;

  switch (finding.status) {
    case 'draft':
      buttons = [{ key: 'promote', label: t('findings.actions.promote'), tone: 'primary', onPress: onPromote }];
      break;
    case 'open':
      buttons = [
        { key: 'resolve', label: t('findings.actions.resolve'), tone: 'success', onPress: onResolve },
        { key: 'start', label: t('findings.actions.startWork'), tone: 'outline', onPress: onStartWork },
      ];
      break;
    case 'in_progress':
      buttons = [
        { key: 'resolve', label: t('findings.actions.resolve'), tone: 'success', onPress: onResolve },
        { key: 'reopen', label: t('findings.actions.reopen'), tone: 'outline', onPress: onReopen },
      ];
      break;
    case 'resolved':
      buttons = isInspector
        ? [
            { key: 'verify', label: t('findings.actions.verify'), tone: 'success', onPress: onVerify },
            { key: 'rework', label: t('findings.actions.rework'), tone: 'outline', onPress: onRework },
          ]
        : [{ key: 'rework', label: t('findings.actions.rework'), tone: 'outline', onPress: onRework }];
      if (!isInspector) note = t('findings.actions.awaitingVerification');
      break;
    case 'verified':
      note = t('findings.actions.terminal');
      break;
  }

  if (buttons.length === 0 && note === null) return null;

  return (
    <View style={styles.actionBar}>
      {note !== null ? <Text style={styles.actionNote}>{note}</Text> : null}
      {buttons.map((b) => (
        <Pressable
          key={b.key}
          style={[
            styles.actionBtn,
            b.tone === 'primary' && styles.actionPrimary,
            b.tone === 'success' && styles.actionSuccess,
            b.tone === 'outline' && styles.actionOutline,
            pending && styles.actionDisabled,
          ]}
          disabled={pending}
          onPress={b.onPress}
        >
          {pending ? (
            <ActivityIndicator color={b.tone === 'outline' ? colors.primary : colors.onPrimary} size="small" />
          ) : (
            <Text style={[styles.actionText, b.tone === 'outline' && styles.actionTextOutline]}>{b.label}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

/** Thumbnails for a set of attachment ids. Online resolves presigned URLs; offline
 * (or while loading) shows a placeholder. */
function PhotoGallery({ projectId, ids }: { projectId: string; ids: string[] }) {
  const { t } = useT();
  const online = useNetworkStatus();
  const { data: urls, isLoading } = useAttachmentUrls(projectId, ids);

  if (!online) {
    return <Text style={styles.galleryPlaceholder}>{t('findings.detail.photosOnline')}</Text>;
  }
  if (isLoading) {
    return <ActivityIndicator color={colors.primary} style={styles.galleryLoading} />;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
      {ids.map((id) => {
        const uri = urls?.[id];
        return (
          <View key={id} style={styles.galleryThumb}>
            {uri !== undefined ? (
              <Image source={{ uri }} style={styles.galleryImg} contentFit="cover" />
            ) : (
              <View style={styles.galleryMissing} />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function anchorSummary(
  f: {
    linked_file_type: string | null;
    anchor_page: number | null;
    anchor_x: number | null;
    anchor_y: number | null;
    anchor_z: number | null;
  },
  t: (key: 'findings.detail.anchorPdf' | 'findings.detail.anchor3d', vars?: Record<string, string | number>) => string,
): string {
  if (f.linked_file_type === 'pdf' && f.anchor_page != null) {
    return t('findings.detail.anchorPdf', { page: f.anchor_page });
  }
  if (f.linked_file_type === 'ifc' && f.anchor_x != null) {
    const coords = `${f.anchor_x.toFixed(1)}, ${f.anchor_y?.toFixed(1) ?? '–'}, ${f.anchor_z?.toFixed(1) ?? '–'}`;
    return t('findings.detail.anchor3d', { coords });
  }
  return f.linked_file_type ?? '';
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { fontSize: 15, color: colors.textMuted },
  retry: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: radii.sm, backgroundColor: colors.primary },
  retryText: { color: colors.onPrimary, fontWeight: '600' },
  scroll: { padding: 20, gap: 16, maxWidth: 760, width: '100%', alignSelf: 'center' },
  badgeRow: { flexDirection: 'row', gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  badgeText: { color: '#ffffff', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  description: { fontSize: 15, color: colors.textSecondary, lineHeight: 22 },
  section: { gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  subLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginTop: 4 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaLabel: { fontSize: 14, color: colors.textMuted },
  metaValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  gallery: { gap: 10, paddingVertical: 2 },
  galleryThumb: {
    width: 96,
    height: 96,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  galleryImg: { width: '100%', height: '100%' },
  galleryMissing: { width: '100%', height: '100%', backgroundColor: colors.surface },
  galleryPlaceholder: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  galleryLoading: { alignSelf: 'flex-start' },
  viewBtn: {
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    marginTop: 8,
  },
  viewBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  actionBar: {
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  actionNote: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  actionBtn: { alignItems: 'center', paddingVertical: 14, borderRadius: radii.lg },
  actionPrimary: { backgroundColor: colors.primary },
  actionSuccess: { backgroundColor: colors.success },
  actionOutline: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  actionDisabled: { opacity: 0.6 },
  actionText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  actionTextOutline: { color: colors.primary },
});
