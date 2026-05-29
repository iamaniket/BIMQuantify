'use client';

import { Box, FileText, type LucideIcon } from 'lucide-react';
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
  const lp = attachment.linked_point;
  const isPdfPin = lp !== null && typeof lp === 'object' && 'page' in lp;

  let config: ChipConfig | null = null;
  if (isElement) {
    config = { icon: Box, label: '3D', colors: 'bg-primary-lighter text-primary' };
  } else if (isPdfPin) {
    const { page } = lp as Record<string, number>;
    config = { icon: FileText, label: `p.${String(page)}`, colors: 'bg-info-lighter text-info-hover' };
  }

  if (config === null) return null;
  const { icon: ChipIcon, label, colors } = config;

  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded font-mono text-[10.5px] font-bold leading-tight tracking-wide',
      colors,
      compact ? 'px-1 py-px' : 'px-1.5 py-0.5',
    )}>
      <ChipIcon className="h-[11px] w-[11px]" />
      <span className="uppercase">{label}</span>
    </span>
  );
}
