'use client';

import { Box, FileText } from '@bimstitch/ui/icons';
import { type AppIcon as LucideIcon } from '@bimstitch/ui';
import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

import type { Attachment } from '@/lib/api/schemas';

type Props = {
  attachment: Attachment;
  compact: boolean | undefined;
};

type ChipConfig = {
  icon: LucideIcon;
  label: string;
  colors: string;
};

export function LinkChip({ attachment, compact = false }: Props): JSX.Element | null {
  const isElement = attachment.linked_element_global_id !== null;
  const isPdfPin = attachment.linked_file_type === 'pdf' && attachment.anchor_page !== null;

  let config: ChipConfig | null = null;
  if (isElement) {
    config = { icon: Box, label: '3D', colors: 'bg-primary-lighter text-primary' };
  } else if (isPdfPin) {
    config = {
      icon: FileText,
      label: `p.${String(attachment.anchor_page)}`,
      colors: 'bg-info-lighter text-info-hover',
    };
  }

  if (config === null) return null;
  const { icon: ChipIcon, label, colors } = config;

  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded font-sans text-[10.5px] font-bold leading-tight tracking-wide',
      colors,
      compact ? 'px-1 py-px' : 'px-1.5 py-0.5',
    )}>
      <ChipIcon className="h-[11px] w-[11px]" />
      <span className="uppercase">{label}</span>
    </span>
  );
}
