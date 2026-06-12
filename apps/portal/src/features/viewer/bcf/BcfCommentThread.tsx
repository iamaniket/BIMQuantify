'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';

import { cn } from '@bimstitch/ui';
import type { Locale } from '@bimstitch/i18n';

import { formatDate } from '@/lib/formatting/dates';
import type { BcfCommentRead } from '@/lib/api/schemas/bcf';

import { useAddBcfComment } from './useAddBcfComment';

type Props = {
  projectId: string;
  topicId: string;
  comments: BcfCommentRead[];
};

export function BcfCommentThread({
  projectId,
  topicId,
  comments,
}: Props): JSX.Element {
  const t = useTranslations('viewer.bcf');
  const locale = useLocale() as Locale;
  const [text, setText] = useState('');
  const addComment = useAddBcfComment(projectId);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();
      if (trimmed === '') return;
      try {
        await addComment.mutateAsync({ topicId, input: { text: trimmed } });
        setText('');
      } catch {
        // useAuthMutation already toasts
      }
    },
    [addComment, text, topicId],
  );

  return (
    <div className="flex flex-col">
      <div className="px-3.5 py-2">
        <p className="font-sans text-[11px] font-semibold uppercase tracking-wider text-foreground-tertiary">
          {t('comments')} ({comments.length})
        </p>
      </div>

      {/* Comment list */}
      {comments.length === 0 && (
        <p className="px-3.5 pb-2 text-caption text-foreground-tertiary">
          {t('noComments')}
        </p>
      )}
      {comments.map((c) => (
        <div
          key={c.id}
          className="border-t border-border px-3.5 py-2"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-medium text-foreground">
              {c.author}
            </span>
            <span className="text-[10px] text-foreground-tertiary">
              {formatDate(c.date, locale)}
            </span>
          </div>
          <p className="mt-0.5 font-sans text-body3 text-foreground-secondary">
            {c.comment_text}
          </p>
        </div>
      ))}

      {/* Add comment form */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-1.5 border-t border-border px-3.5 py-2"
      >
        <input
          type="text"
          placeholder={t('addCommentPlaceholder')}
          value={text}
          onChange={(e) => { setText(e.target.value); }}
          className="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 font-sans text-body3 text-foreground placeholder:text-foreground-tertiary focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          disabled={text.trim() === '' || addComment.isPending}
          className={cn(
            'h-8 shrink-0 rounded bg-primary px-3 font-sans text-body3 font-medium text-primary-foreground transition-colors',
            'disabled:opacity-50',
          )}
        >
          {t('send')}
        </button>
      </form>
    </div>
  );
}
