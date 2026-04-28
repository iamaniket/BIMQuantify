import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type CardProps = HTMLAttributes<HTMLDivElement>;

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-background',
        'transition-colors hover:border-border-hover',
        className,
      )}
      {...rest}
    />
  ),
);

Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 px-4 pt-4', className)}
      {...rest}
    />
  ),
);

CardHeader.displayName = 'CardHeader';

export const CardBody = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-1 flex-col gap-2 px-4 py-4', className)}
      {...rest}
    />
  ),
);

CardBody.displayName = 'CardBody';

export const CardFooter = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-between border-t border-border px-4 py-3',
        className,
      )}
      {...rest}
    />
  ),
);

CardFooter.displayName = 'CardFooter';
