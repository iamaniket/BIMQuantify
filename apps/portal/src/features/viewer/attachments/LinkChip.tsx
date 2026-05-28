'use client';

import { Box, FileText } from 'lucide-react';
import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

import type { Attachment } from '@/lib/api/schemas';

type Props = {
  attachment: Attachment;
  compact: boolean | undefined;
};

export function LinkChip({ attachment, compact = false }: Props): JSX.Element | null {
  const isElement = attachment.linked_element_global_id !== null;
  const isPdfPin = attachment.linked_point !== null
    && typeof attachment.linked_point === 'object'
    && 'page' in attachment.linked_point;

  if (!isElement && !isPdfPin) return null;

  if (isElement) {
    return (
      <span className={cn(
        'inline-flex items-center gap-1 rounded',
        'bg-primary-lighter font-mono text-[10.5px] font-bold leading-tight tracking-wide text-primary',
        compact ? 'px-1 py-px' : 'px-1.5 py-0.5',
      )}>
        <Box className="h-[11px] w-[11px]" />
        <span className="uppercase">3D</span>
      </span>
    );
  }

  const lp = attachment.linked_point;
  if (lp === null) return null;
  const { page } = lp as Record<string, number>;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded',
      'bg-info-lighter font-mono text-[10.5px] font-bold leading-tight tracking-wide text-info-hover',
      compact ? 'px-1 py-px' : 'px-1.5 py-0.5',
    )}>
      <FileText className="h-[11px] w-[11px]" />
      <span className="uppercase">p.{String(page)}</span>
    </span>
  );
}
