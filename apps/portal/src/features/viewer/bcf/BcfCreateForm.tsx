'use client';

import { useTranslations } from 'next-intl';
import {
  useCallback, useState, type JSX,
} from 'react';
import { toast } from 'sonner';

import { cn } from '@bimstitch/ui';

import { uploadSnapshot } from '@/lib/api/bcf';
import { tokenManager } from '@/lib/auth/tokenManager';
import { useAuth } from '@/providers/AuthProvider';

import type { BcfController } from './useBcfController';
import { useCreateBcfTopic } from './useCreateBcfTopic';

type Props = {
  projectId: string;
  controller: BcfController;
  onCreated: (topicId: string) => void;
  onCancel?: () => void;
};

export function BcfCreateForm({
  projectId,
  controller,
  onCreated,
  onCancel,
}: Props): JSX.Element {
  const t = useTranslations('viewer.bcf');
  const { tokens } = useAuth();
  const createMutation = useCreateBcfTopic(projectId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [topicType, setTopicType] = useState('Issue');
  const [topicStatus, setTopicStatus] = useState('Open');
  const [priority, setPriority] = useState('');
  const [captureView, setCaptureView] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // In 2D markup mode the drawn shape IS the viewpoint — always capture it and
  // hide the toggle. In 3D the toggle controls whether the camera is captured.
  const is2d = controller.captureMode === '2d';

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (title.trim() === '') return;
      setIsSubmitting(true);

      try {
        let viewpointPayload = undefined;
        let snapshotDataUrl: string | null = null;

        // Capture the current view (3D camera) or markup draft (2D).
        if ((is2d || captureView) && controller.canCapture) {
          const result = await controller.capture();
          if (result !== null) {
            viewpointPayload = result.viewpoint;
            snapshotDataUrl = result.snapshotDataUrl;
          }
        }

        const topic = await createMutation.mutateAsync({
          title: title.trim(),
          description: description.trim() || undefined,
          topic_type: topicType,
          topic_status: topicStatus,
          priority: priority || undefined,
          labels: [],
          viewpoint: viewpointPayload,
        });

        // Upload snapshot if we have one and a viewpoint was created
        if (
          snapshotDataUrl !== null &&
          topic.viewpoints.length > 0
        ) {
          const vp = topic.viewpoints[0]!;
          const accessToken = tokens?.access_token ?? await tokenManager.refresh();
          try {
            await uploadSnapshot(
              accessToken,
              projectId,
              topic.id,
              vp.id,
              snapshotDataUrl,
            );
          } catch {
            // Non-fatal: topic was created, snapshot upload just failed
            toast.warning(t('snapshotUploadFailed'));
          }
        }

        toast.success(t('createSuccess'));
        onCreated(topic.id);
      } catch {
        // useAuthMutation already toasts
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      title,
      description,
      topicType,
      topicStatus,
      priority,
      captureView,
      is2d,
      controller,
      createMutation,
      tokens,
      projectId,
      t,
      onCreated,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 py-1">
          {/* Title */}
          <div>
            <label className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wider text-foreground-tertiary">
              {t('titleLabel')} *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); }}
              placeholder={t('titlePlaceholder')}
              required
              className="h-8 w-full rounded border border-border bg-background px-2 font-sans text-body3 text-foreground placeholder:text-foreground-tertiary focus:border-primary focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wider text-foreground-tertiary">
              {t('descriptionLabel')}
            </label>
            <textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); }}
              placeholder={t('descriptionPlaceholder')}
              rows={3}
              className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 font-sans text-body3 text-foreground placeholder:text-foreground-tertiary focus:border-primary focus:outline-none"
            />
          </div>

          {/* Type + Status row */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wider text-foreground-tertiary">
                {t('typeLabel')}
              </label>
              <select
                value={topicType}
                onChange={(e) => { setTopicType(e.target.value); }}
                className="h-8 w-full rounded border border-border bg-background px-2 font-sans text-body3 text-foreground focus:border-primary focus:outline-none"
              >
                <option value="Issue">{t('type.issue')}</option>
                <option value="Warning">{t('type.warning')}</option>
                <option value="Request">{t('type.request')}</option>
                <option value="Fault">{t('type.fault')}</option>
                <option value="Inquiry">{t('type.inquiry')}</option>
                <option value="Remark">{t('type.remark')}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wider text-foreground-tertiary">
                {t('statusLabel')}
              </label>
              <select
                value={topicStatus}
                onChange={(e) => { setTopicStatus(e.target.value); }}
                className="h-8 w-full rounded border border-border bg-background px-2 font-sans text-body3 text-foreground focus:border-primary focus:outline-none"
              >
                <option value="Open">{t('status.open')}</option>
                <option value="In Progress">{t('status.in_progress')}</option>
                <option value="Closed">{t('status.closed')}</option>
              </select>
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="mb-1 block font-sans text-[11px] font-semibold uppercase tracking-wider text-foreground-tertiary">
              {t('priorityLabel')}
            </label>
            <select
              value={priority}
              onChange={(e) => { setPriority(e.target.value); }}
              className="h-8 w-full rounded border border-border bg-background px-2 font-sans text-body3 text-foreground focus:border-primary focus:outline-none"
            >
              <option value="">{t('priority.none')}</option>
              <option value="High">{t('priority.high')}</option>
              <option value="Medium">{t('priority.medium')}</option>
              <option value="Low">{t('priority.low')}</option>
            </select>
          </div>

          {/* Capture toggle — 3D only; in 2D the markup is always captured. */}
          {!is2d && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={captureView}
                onChange={(e) => { setCaptureView(e.target.checked); }}
                className="h-4 w-4 rounded border-border"
              />
              <span className="font-sans text-body3 text-foreground-secondary">
                {t('captureCurrentView')}
              </span>
            </label>
          )}

        {/* Submit (+ Cancel for the 2D draw-first flow) */}
        <div className="flex items-center gap-2">
          {onCancel !== undefined && (
            <button
              type="button"
              onClick={onCancel}
              className="h-9 shrink-0 rounded border border-border bg-background px-3 font-sans text-body3 font-medium text-foreground-secondary transition-colors hover:bg-background-hover"
            >
              {t('cancel')}
            </button>
          )}
          <button
            type="submit"
            disabled={title.trim() === '' || isSubmitting}
            className={cn(
              'h-9 flex-1 rounded bg-primary font-sans text-body3 font-medium text-primary-foreground transition-colors',
              'hover:bg-primary-hover disabled:opacity-50',
            )}
          >
            {isSubmitting ? t('creating') : t('createIssue')}
          </button>
        </div>
    </form>
  );
}
