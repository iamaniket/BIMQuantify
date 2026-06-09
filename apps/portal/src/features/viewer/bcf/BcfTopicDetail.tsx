'use client';

import { ArrowLeft, Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog, cn } from '@bimstitch/ui';
import type { ViewerHandle } from '@bimstitch/viewer';

import { PanelButton } from '@/components/shared/viewer/shared/PanelButton';
import { PanelButtonRow, PanelToolbar } from '@/components/shared/viewer/shared/PanelToolbar';

import { BcfCommentThread } from './BcfCommentThread';
import { useBcfTopic } from './useBcfTopic';
import { useDeleteBcfTopic } from './useDeleteBcfTopic';

type Props = {
  projectId: string;
  topicId: string;
  handle: ViewerHandle | null;
  onBack: () => void;
};

export function BcfTopicDetail({
  projectId,
  topicId,
  handle,
  onBack,
}: Props): JSX.Element {
  const t = useTranslations('viewer.bcf');
  const { data: topic, isLoading } = useBcfTopic(projectId, topicId);
  const deleteMutation = useDeleteBcfTopic(projectId);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleRestoreView = useCallback(async () => {
    if (handle === null || topic === undefined) return;
    const vp = topic.viewpoints[0];
    if (vp === undefined) return;

    const cam = {
      type: vp.camera_type as 'perspective' | 'orthographic',
      viewPoint: vp.camera_view_point as { x: number; y: number; z: number },
      direction: vp.camera_direction as { x: number; y: number; z: number },
      upVector: vp.camera_up_vector as { x: number; y: number; z: number },
      fieldOfView: vp.field_of_view ?? undefined,
      fieldOfHeight: vp.field_of_height ?? undefined,
    };

    const vpData: Record<string, unknown> = { camera: cam };

    if (vp.components !== null) {
      const comp = vp.components as Record<string, unknown>;
      vpData['components'] = {
        visibility: {
          defaultVisibility: comp['default_visibility'] ?? true,
          exceptions: comp['visibility_exceptions'] ?? [],
        },
        selection: comp['selection'] ?? [],
      };
    }

    if (vp.clipping_planes !== null && Array.isArray(vp.clipping_planes)) {
      vpData['clippingPlanes'] = vp.clipping_planes;
    }

    await handle.commands.execute('bcf.applyViewpoint', vpData);
  }, [handle, topic]);

  const handleDelete = useCallback(async () => {
    try {
      await deleteMutation.mutateAsync(topicId);
      toast.success(t('deleteSuccess'));
      onBack();
    } catch {
      // useAuthMutation already toasts
    }
  }, [deleteMutation, topicId, t, onBack]);

  if (isLoading || topic === undefined) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-caption text-foreground-tertiary">{t('loading')}</p>
      </div>
    );
  }

  const firstVp = topic.viewpoints[0];
  const snapshotUrl = firstVp?.snapshot_url;

  return (
    <div className="flex h-full flex-col">
      <PanelToolbar>
        <PanelButtonRow>
          <PanelButton
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
            onClick={onBack}
          >
            {t('backToList')}
          </PanelButton>
          <PanelButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => { setShowDeleteConfirm(true); }}
          />
        </PanelButtonRow>
      </PanelToolbar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Snapshot */}
        {snapshotUrl !== undefined && snapshotUrl !== null && (
          <div className="border-b border-border">
            <img
              src={snapshotUrl}
              alt={t('snapshotAlt')}
              className="w-full object-contain"
            />
          </div>
        )}

        {/* Topic info */}
        <div className="border-b border-border px-3.5 py-3">
          <h3 className="font-sans text-body2 font-semibold text-foreground">
            {topic.title}
          </h3>
          {topic.description !== null && (
            <p className="mt-1 font-sans text-body3 text-foreground-secondary">
              {topic.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-surface-low px-2 py-0.5 font-medium text-foreground-secondary">
              {topic.topic_status}
            </span>
            <span className="rounded-full bg-surface-low px-2 py-0.5 font-medium text-foreground-secondary">
              {topic.topic_type}
            </span>
            {topic.priority !== null && (
              <span className="rounded-full bg-surface-low px-2 py-0.5 font-medium text-foreground-secondary">
                {topic.priority}
              </span>
            )}
          </div>
          {topic.assigned_to !== null && (
            <p className="mt-1.5 text-[11px] text-foreground-tertiary">
              {t('assignedTo')}: {topic.assigned_to}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-foreground-tertiary">
            {topic.creation_author} &middot;{' '}
            {new Date(topic.creation_date).toLocaleDateString()}
          </p>
        </div>

        {/* Labels */}
        {topic.labels !== null && topic.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border px-3.5 py-2">
            {topic.labels.map((label) => (
              <span
                key={label}
                className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              >
                {label}
              </span>
            ))}
          </div>
        )}

        {/* Restore viewpoint */}
        {firstVp !== undefined && (
          <div className="border-b border-border px-3.5 py-2">
            <PanelButton variant="primary" onClick={handleRestoreView}>
              {t('restoreView')}
            </PanelButton>
          </div>
        )}

        {/* Comments */}
        <BcfCommentThread
          projectId={projectId}
          topicId={topicId}
          comments={topic.comments}
        />
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={t('deleteConfirmTitle')}
        description={t('deleteConfirmDescription')}
        confirmLabel={t('deleteConfirmAction')}
        cancelLabel={t('cancel')}
        variant="destructive"
        isPending={deleteMutation.isPending}
        errorMessage={null}
        onConfirm={handleDelete}
      />
    </div>
  );
}
