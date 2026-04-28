import { forwardRef, type LabelHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...rest }, ref) => (
    <label
      ref={ref}
      className={cn('text-label2 font-medium text-foreground', className)}
      {...rest}
    />
  ),
);

Label.displayName = 'Label';
