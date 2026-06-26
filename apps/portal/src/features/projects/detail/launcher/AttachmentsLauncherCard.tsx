'use client';

import {
  FileAudio, FileText, FileVideo, Image, Paperclip, Plus, User,
} from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import {
  useRef, useState, type ChangeEvent, type ComponentType, type JSX,
} from 'react';
import { toast } from 'sonner';

import type { Locale } from '@bimdossier/i18n';
import {
  Badge, Button, IconTile, MediaRow,
} from '@bimdossier/ui';

import { UserAvatar } from '@/components/shared/UserAvatar';
import { AttachmentViewerDialog } from '@/features/attachments/AttachmentViewerDialog';
import { formatSize } from '@/features/attachments/attachmentMeta';
import { useUploadAttachment } from '@/features/attachments/useUploadAttachment';
import { useProjectOverview } from '@/features/projects/useProjectOverview';
import { useProjectPermissions } from '@/features/permissions';
import type { Attachment, AttachmentCategoryValue } from '@/lib/api/schemas';
import { formatAgo, formatDateTime } from '@/lib/formatting/dates';

import { LauncherPanel } from './LauncherPanel';

const MAX_ROWS = 4;
const ROW_HEIGHT_PX = 34;

const CATEGORY_ICON: Record<AttachmentCategoryValue, ComponentType<{ className?: string }>> = {
  image: Image,
  video: FileVideo,
  audio: FileAudio,
  office: FileText,
  other: FileText,
};

/** Short, i18n-free file-extension chip ("PDF", "JPG"), falling back to "FILE". */
function extensionLabel(filename: string): string {
  if (!filename.includes('.')) return 'FILE';
  return (filename.split('.').pop() ?? '').toUpperCase() || 'FILE';
}

export function AttachmentsLauncherCard({ projectId }: { projectId: string }): JSX.Element {
  const t = useTranslations('projectDetail.tabs');
  const tAtt = useTranslations('projectDetail.tabs.attachments');
  const locale = useLocale() as Locale;
  const { can } = useProjectPermissions(projectId);
  // Attachment preview + count come from the shared project-overview aggregate.
  const overviewQuery = useProjectOverview(projectId);
  const attBlock = overviewQuery.data?.attachments;
  const upload = useUploadAttachment(projectId);
  const inputRef = useRef<HTMLInputElement>(null);

  const [viewing, setViewing] = useState<Attachment | null>(null);

  // Only "ready" attachments have an object to preview; pending/rejected ones
  // can't be opened, so they're filtered out of the recent preview. (The
  // overview block already serves ready head-of-group attachments, so the
  // filter is a belt-and-braces guard.)
  const recent =
    (attBlock?.preview ?? []).filter((a) => a.status === 'ready').slice(0, MAX_ROWS);
  const count = attBlock?.count ?? 0;

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined) return;
    upload.mutate(
      { file },
      {
        onSuccess: () => { toast.success(tAtt('uploadSuccess', { name: file.name })); },
        onError: () => { toast.error(tAtt('uploadError', { name: file.name })); },
      },
    );
  };

  const createAction = can('attachment', 'create') ? (
    <Button
      variant="primary"
      size="md"
      disabled={upload.isPending}
      onClick={() => { inputRef.current?.click(); }}
    >
      <Plus className="h-3.5 w-3.5" />
      {t('nav.new')}
    </Button>
  ) : undefined;

  return (
    <>
      <LauncherPanel
        icon={<Paperclip className="h-4 w-4" />}
        label={t('attachments.label')}
        count={count}
        boardHref={`/projects/${projectId}/attachments`}
        viewAllLabel={t('nav.viewAll')}
        headerAction={createAction}
        emptyLabel={t('nav.empty')}
        isLoading={overviewQuery.isLoading}
        isEmpty={recent.length === 0}
        rowHeightPx={ROW_HEIGHT_PX}
        maxRows={MAX_ROWS}
      >
        {(visible) => recent.slice(0, visible).map((a) => {
          const Icon = CATEGORY_ICON[a.attachment_category ?? 'other'];
          const createdSeconds = (Date.now() - new Date(a.created_at).getTime()) / 1000;
          return (
            <MediaRow
              key={a.id}
              className="min-h-[34px] max-h-[48px] flex-1"
              media={<IconTile tone="neutral" size="md"><Icon className="h-4 w-4" /></IconTile>}
              title={a.original_filename}
              description={a.description ?? a.content_type}
              trailing={(
                <div className="flex items-center gap-3 text-caption text-foreground-tertiary">
                  <span className="w-[64px] shrink-0 whitespace-nowrap text-right tabular-nums">
                    {formatSize(a.size_bytes)}
                  </span>
                  <span
                    className="w-[52px] shrink-0 whitespace-nowrap text-right"
                    title={formatDateTime(a.created_at, locale)}
                  >
                    {formatAgo(createdSeconds, locale)}
                  </span>
                  <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
                  {a.uploaded_by_name !== null && a.uploaded_by_name !== '' ? (
                    <UserAvatar name={a.uploaded_by_name} size="sm" />
                  ) : (
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-border text-foreground-tertiary"
                    >
                      <User className="h-3 w-3" />
                    </span>
                  )}
                  <Badge variant="default" size="sm">
                    {extensionLabel(a.original_filename)}
                  </Badge>
                </div>
              )}
              showChevron
              onClick={() => { setViewing(a); }}
            />
          );
        })}
      </LauncherPanel>

      <input ref={inputRef} type="file" className="hidden" onChange={onPick} />
      <AttachmentViewerDialog
        attachment={viewing}
        projectId={projectId}
        open={viewing !== null}
        onOpenChange={(o) => { if (!o) setViewing(null); }}
      />
    </>
  );
}
