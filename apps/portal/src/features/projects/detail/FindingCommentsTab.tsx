'use client';

import { Pencil, Trash2 } from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import type { Locale } from '@bimdossier/i18n';

import { UserAvatar } from '@/components/shared/UserAvatar';
import {
  useCreateFindingComment,
  useDeleteFindingComment,
  useUpdateFindingComment,
} from '@/features/findings/useFindingCommentMutations';
import { useFindingComments } from '@/features/findings/useFindingComments';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useProjectPermissions } from '@/features/permissions/useProjectPermissions';
import type { Finding, FindingComment } from '@/lib/api/schemas';
import { formatDateTime } from '@/lib/formatting/dates';
import { useAuth } from '@/providers/AuthProvider';

import { CommentComposer } from './CommentComposer';
import {
  parseCommentSegments,
  parseMentionsFromText,
  tokensToDisplay,
  type MemberLike,
} from './commentMentions';

type Props = {
  projectId: string;
  finding: Finding;
};

/** Renders a comment body with @mention tokens shown as chips. */
function CommentBody({ text }: { text: string }): JSX.Element {
  return (
    <p className="whitespace-pre-wrap break-words text-body3 text-foreground-secondary">
      {parseCommentSegments(text).map((seg, i) => (seg.type === 'mention' ? (
          <span
            key={i}
            className="rounded bg-primary-light px-1 font-medium text-primary"
          >
            @{seg.label}
          </span>
      ) : (
          <span key={i}>{seg.value}</span>
      )))}
    </p>
  );
}

/**
 * Discussion thread for a finding — the dialog-free twin of the History tab.
 * Lists comments oldest-first with @mention chips, and (for members who can
 * write findings) a mention-aware composer. Authors edit/delete their own
 * comments; finding.delete holders can moderate any.
 */
export function FindingCommentsTab({ projectId, finding }: Props): JSX.Element {
  const t = useTranslations('findings.detail.comments');
  const locale = useLocale() as Locale;
  const { me } = useAuth();
  const currentUserId = me ? me.user.id : null;

  const comments = useFindingComments(projectId, finding.id);
  const membersQuery = useProjectMembers(projectId);
  const permissions = useProjectPermissions(projectId);

  const create = useCreateFindingComment(projectId, finding.id);
  const update = useUpdateFindingComment(projectId, finding.id);
  const remove = useDeleteFindingComment(projectId, finding.id);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const members = useMemo<MemberLike[]>(
    () => (membersQuery.data ?? []).map((m) => ({
      user_id: m.user_id,
      full_name: m.full_name,
      email: m.email,
    })),
    [membersQuery.data],
  );

  const canComment = permissions.can('finding', 'create');
  const canModerate = permissions.can('finding', 'delete');

  const authorName = (comment: FindingComment): string => comment.actor_name ?? comment.author;

  const startEdit = (commentId: string): void => {
    setEditingId(commentId);
    setConfirmDeleteId(null);
  };

  if (comments.isLoading) {
    return (
      <div className="space-y-3 py-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex animate-pulse gap-3">
            <div className="h-7 w-7 shrink-0 rounded-full bg-surface-high" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-1/3 rounded bg-surface-high" />
              <div className="h-3 w-3/4 rounded bg-surface-high" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const entries = comments.data ?? [];

  return (
    <div className="flex flex-col gap-4 py-1">
      {entries.length === 0 ? (
        <div className="px-2 py-6 text-center text-body3 text-foreground-tertiary">
          {t('empty')}
        </div>
      ) : (
        <ol className="flex flex-col gap-4">
          {entries.map((comment) => {
            const isAuthor = comment.created_by_user_id === currentUserId;
            const isEditing = editingId === comment.id;
            return (
              <li key={comment.id} className="flex gap-3">
                <UserAvatar
                  name={authorName(comment)}
                  {...(comment.actor_email !== null ? { email: comment.actor_email } : {})}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-body3 font-semibold text-foreground">
                      {authorName(comment)}
                    </span>
                    <span className="whitespace-nowrap text-caption text-foreground-tertiary tabular-nums">
                      {formatDateTime(comment.date, locale)}
                    </span>
                    {comment.modified_date !== null && (
                      <span className="text-caption text-foreground-tertiary">
                        · {t('edited')}
                      </span>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="mt-1.5">
                      <CommentComposer
                        members={members}
                        submitLabel={t('save')}
                        placeholder={t('placeholder')}
                        focusOnMount
                        initialText={tokensToDisplay(comment.comment_text)}
                        initialMentions={parseMentionsFromText(comment.comment_text)}
                        onCancel={() => { setEditingId(null); }}
                        onSubmit={async (text) => {
                          await update.mutateAsync({ commentId: comment.id, input: { text } });
                          setEditingId(null);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="mt-0.5">
                      <CommentBody text={comment.comment_text} />
                      {(isAuthor || canModerate) && (
                        <div className="mt-1 flex items-center gap-2">
                          {isAuthor && (
                            <button
                              type="button"
                              onClick={() => { startEdit(comment.id); }}
                              className="inline-flex items-center gap-1 text-caption text-foreground-tertiary hover:text-foreground-secondary"
                            >
                              <Pencil className="h-3 w-3" />
                              {t('edit')}
                            </button>
                          )}
                          {confirmDeleteId === comment.id ? (
                            <>
                              <button
                                type="button"
                                disabled={remove.isPending}
                                onClick={async () => {
                                  await remove.mutateAsync({ commentId: comment.id });
                                  setConfirmDeleteId(null);
                                }}
                                className="text-caption font-medium text-error hover:underline"
                              >
                                {t('confirmDelete')}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setConfirmDeleteId(null); }}
                                className="text-caption text-foreground-tertiary hover:text-foreground-secondary"
                              >
                                {t('cancel')}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setConfirmDeleteId(comment.id); }}
                              className="inline-flex items-center gap-1 text-caption text-foreground-tertiary hover:text-error"
                            >
                              <Trash2 className="h-3 w-3" />
                              {t('delete')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {canComment && (
        <div className="border-t border-border pt-3">
          <CommentComposer
            members={members}
            submitLabel={t('send')}
            placeholder={t('placeholder')}
            onSubmit={async (text) => {
              await create.mutateAsync({ input: { text } });
            }}
          />
        </div>
      )}
    </div>
  );
}
