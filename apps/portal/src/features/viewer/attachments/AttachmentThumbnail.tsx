'use client';

import {
  FileAudio,
  FileText,
  FileVideo,
  Image,
} from 'lucide-react';
import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

import type { Attachment } from '@/lib/api/schemas';

import { useAttachmentViewUrl } from '../../attachments/useAttachmentViewUrl';

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  image: Image,
  video: FileVideo,
  audio: FileAudio,
  office: FileText,
  other: FileText,
};

type FileTypeMeta = { label: string; tintClass: string; bgClass: string };

const FILE_TYPE_META: Record<string, FileTypeMeta> = {
  pdf: { label: 'PDF', tintClass: 'text-error', bgClass: 'bg-error/10' },
  doc: { label: 'DOC', tintClass: 'text-info', bgClass: 'bg-info/10' },
  docx: { label: 'DOC', tintClass: 'text-info', bgClass: 'bg-info/10' },
  txt: { label: 'TXT', tintClass: 'text-foreground-secondary', bgClass: 'bg-background-secondary' },
  csv: { label: 'CSV', tintClass: 'text-success', bgClass: 'bg-success/10' },
  xls: { label: 'XLS', tintClass: 'text-success', bgClass: 'bg-success/10' },
  xlsx: { label: 'XLS', tintClass: 'text-success', bgClass: 'bg-success/10' },
  dwg: { label: 'DWG', tintClass: 'text-warning', bgClass: 'bg-warning/10' },
  rvt: { label: 'RVT', tintClass: 'text-[#7a3aa6]', bgClass: 'bg-[#7a3aa6]/10' },
  ifc: { label: 'IFC', tintClass: 'text-info', bgClass: 'bg-info/10' },
  zip: { label: 'ZIP', tintClass: 'text-foreground-secondary', bgClass: 'bg-background-secondary' },
};

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

type Props = {
  attachment: Attachment;
  projectId: string;
  size: 'sm' | 'md' | undefined;
  className: string | undefined;
};

export function AttachmentThumbnail({
  attachment,
  projectId,
  size = 'md',
  className,
}: Props): JSX.Element {
  const viewUrlQuery = useAttachmentViewUrl(
    projectId,
    attachment.attachment_category === 'image' ? attachment.id : null,
  );

  const sizeClass = size === 'sm' ? 'h-[26px] w-[26px]' : 'h-10 w-10';
  const viewData = viewUrlQuery.data;
  const downloadUrl = viewData !== undefined
    ? viewData.download_url
    : undefined;

  if (attachment.attachment_category === 'image' && downloadUrl !== undefined) {
    return (
      <div className={cn(
        'shrink-0 overflow-hidden rounded border border-border',
        sizeClass,
        className,
      )}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={downloadUrl}
          alt={attachment.original_filename}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  if (attachment.attachment_category === 'image') {
    return (
      <div className={cn(
        'shrink-0 overflow-hidden rounded border border-border',
        'bg-[repeating-linear-gradient(135deg,var(--surface-low)_0_4px,var(--surface-page)_4px_8px)]',
        'flex items-center justify-center',
        sizeClass,
        className,
      )}>
        <span className="font-mono text-[9px] tracking-wide text-foreground-tertiary">IMG</span>
      </div>
    );
  }

  const ext = getExtension(attachment.original_filename);
  const meta = FILE_TYPE_META[ext];

  if (meta) {
    return (
      <div className={cn(
        'shrink-0 rounded border border-border',
        'flex flex-col items-center justify-center gap-0.5',
        meta.bgClass,
        meta.tintClass,
        sizeClass,
        className,
      )}>
        <FileText className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        <span className="font-mono text-[8.5px] font-bold leading-none tracking-wide">
          {meta.label}
        </span>
      </div>
    );
  }

  const Icon = CATEGORY_ICONS[attachment.attachment_category] ?? FileText;
  return (
    <div className={cn(
      'shrink-0 rounded border border-border bg-background-secondary',
      'flex items-center justify-center',
      sizeClass,
      className,
    )}>
      <Icon className={cn(
        'text-foreground-tertiary',
        size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5',
      )} />
    </div>
  );
}
