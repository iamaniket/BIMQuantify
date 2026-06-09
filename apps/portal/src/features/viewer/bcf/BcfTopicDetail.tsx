'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { BcfCommentThread } from './BcfCommentThread';
import { useBcfTopic } from './useBcfTopic';

type Props = {
  projectId: string;
  topicId: string;
};

export function BcfTopicDetail({
  projectId,
  topicId,
}: Props): JSX.Element {
  const t = useTranslations('viewer.bcf');
  const { data: topic, isLoading } = useBcfTopic(projectId, topicId);

  if (isLoading || topic === undefined) {
    return (
      <div className="flex items-center justify-center py-4">
        <p className="text-caption text-foreground-tertiary">{t('loading')}</p>
      </div>
    );
  }

  const firstVp = topic.viewpoints[0];
  const snapshotUrl = firstVp?.snapshot_url;

  return (
    <>
      {/* Snapshot */}
      {snapshotUrl !== undefined && snapshotUrl !== null && (
        <div className="mb-2 overflow-hidden rounded border border-border">
          <img
            src={snapshotUrl}
            alt={t('snapshotAlt')}
            className="w-full object-contain"
          />
        </div>
      )}

      {/* Topic info */}
      <div className="mb-2">
        {topic.description !== null && (
          <p className="mb-1.5 font-sans text-body3 text-foreground-secondary">
            {topic.description}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-full bg-background px-2 py-0.5 font-medium text-foreground-secondary ring-1 ring-border">
            {topic.topic_status}
          </span>
          <span className="rounded-full bg-background px-2 py-0.5 font-medium text-foreground-secondary ring-1 ring-border">
            {topic.topic_type}
          </span>
          {topic.priority !== null && (
            <span className="rounded-full bg-background px-2 py-0.5 font-medium text-foreground-secondary ring-1 ring-border">
              {topic.priority}
            </span>
          )}
        </div>
        {topic.assigned_to !== null && (
          <p className="mt-1.5 text-[11px] text-foreground-tertiary">
            {t('assignedTo')}: {topic.assigned_to}
          </p>
        )}
      </div>

      {/* Labels */}
      {topic.labels !== null && topic.labels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
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

      {/* Comments */}
      <BcfCommentThread
        projectId={projectId}
        topicId={topicId}
        comments={topic.comments}
      />
    </>
  );
}
