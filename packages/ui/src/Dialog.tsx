'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
} from 'react';

import { cn } from './lib/cn.js';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

const overlayStyles =
  'fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm';

const contentStyles =
  'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 '
  + 'rounded-lg border border-border bg-background shadow-lg '
  + 'focus:outline-none';

export type DialogContentProps = ComponentPropsWithoutRef<typeof RadixDialog.Content>;

export const DialogContent = forwardRef<
  ElementRef<typeof RadixDialog.Content>,
  DialogContentProps
>(({ className, children, ...rest }, ref) => (
  <RadixDialog.Portal>
    <RadixDialog.Overlay className={overlayStyles} />
    <RadixDialog.Content ref={ref} className={cn(contentStyles, className)} {...rest}>
      {children}
    </RadixDialog.Content>
  </RadixDialog.Portal>
));

DialogContent.displayName = 'DialogContent';

export type DialogSectionProps = HTMLAttributes<HTMLDivElement>;

export const DialogHeader = forwardRef<HTMLDivElement, DialogSectionProps>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 px-5 pt-5', className)}
      {...rest}
    />
  ),
);

DialogHeader.displayName = 'DialogHeader';

export const DialogBody = forwardRef<HTMLDivElement, DialogSectionProps>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-4 px-5 py-4', className)}
      {...rest}
    />
  ),
);

DialogBody.displayName = 'DialogBody';

export const DialogFooter = forwardRef<HTMLDivElement, DialogSectionProps>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex justify-end gap-2 border-t border-border px-5 py-4',
        className,
      )}
      {...rest}
    />
  ),
);

DialogFooter.displayName = 'DialogFooter';

export type DialogTitleProps = ComponentPropsWithoutRef<typeof RadixDialog.Title>;

export const DialogTitle = forwardRef<
  ElementRef<typeof RadixDialog.Title>,
  DialogTitleProps
>(({ className, ...rest }, ref) => (
  <RadixDialog.Title
    ref={ref}
    className={cn('text-h6 font-semibold text-foreground', className)}
    {...rest}
  />
));

DialogTitle.displayName = 'DialogTitle';

export type DialogDescriptionProps = ComponentPropsWithoutRef<typeof RadixDialog.Description>;

export const DialogDescription = forwardRef<
  ElementRef<typeof RadixDialog.Description>,
  DialogDescriptionProps
>(({ className, ...rest }, ref) => (
  <RadixDialog.Description
    ref={ref}
    className={cn('text-body2 text-foreground-secondary', className)}
    {...rest}
  />
));

DialogDescription.displayName = 'DialogDescription';
