import type { ReactNode } from 'react';

import { cn } from '@bimstitch/ui';

export function Eyebrow({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'span';
}): ReactNode {
  return (
    <Tag className={cn('text-caption font-bold uppercase tracking-widest text-foreground-tertiary', className)}>
      {children}
    </Tag>
  );
}
