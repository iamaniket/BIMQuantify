'use client';

import type { JSX } from 'react';

import { Button } from './Button.js';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './Dialog.js';

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  variant: 'default' | 'destructive';
  isPending: boolean;
  errorMessage: string | null | undefined;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  variant,
  isPending,
  errorMessage,
}: ConfirmDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {errorMessage === null || errorMessage === undefined ? null : (
          <DialogBody>
            <div
              role="alert"
              className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-body3 text-error"
            >
              {errorMessage}
            </div>
          </DialogBody>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="border" size="md" disabled={isPending}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant={variant === 'destructive' ? 'destructive' : 'primary'}
            size="md"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? `${confirmLabel}…` : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
