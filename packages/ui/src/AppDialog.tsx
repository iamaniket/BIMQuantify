'use client';

import { X } from 'lucide-react';
import { useCallback, type JSX, type ReactNode } from 'react';

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
import { cn } from './lib/cn.js';

export type AppDialogProps = {
  open: boolean;
  onClose: () => void;

  eyebrow?: string;
  title: string;
  subtitle?: string;
  headerMeta?: ReactNode;

  children?: ReactNode;

  footerInfo?: ReactNode;
  onSave?: () => void;
  onReset?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  resetLabel?: string;
  saveDisabled?: boolean;
  saveTone?: 'primary' | 'danger';

  width?: number;
  className?: string;
};

export function AppDialog({
  open,
  onClose,
  eyebrow,
  title,
  subtitle,
  headerMeta,
  children,
  footerInfo,
  onSave,
  onReset,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  resetLabel = 'Reset',
  saveDisabled = false,
  saveTone = 'primary',
  width = 520,
  className,
}: AppDialogProps): JSX.Element {
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) onClose();
    },
    [onClose],
  );

  const hasFooter =
    footerInfo !== undefined || onSave !== undefined || onReset !== undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn('flex max-w-none flex-col max-h-[calc(100vh-48px)]', className)}
        style={{ width, maxWidth: 'calc(100vw - 48px)' }}
      >
        {/* Header */}
        <DialogHeader className="relative flex-row items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {eyebrow !== undefined && (
              <span className="text-caption font-bold uppercase tracking-[0.14em] text-primary">
                {eyebrow}
              </span>
            )}
            <DialogTitle>{title}</DialogTitle>
            {subtitle !== undefined && (
              <DialogDescription>{subtitle}</DialogDescription>
            )}
          </div>
          {headerMeta !== undefined && (
            <div className="shrink-0">{headerMeta}</div>
          )}
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close"
              className="shrink-0 rounded-md p-1 text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </DialogHeader>

        {/* Body */}
        <DialogBody className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </DialogBody>

        {/* Footer */}
        {hasFooter && (
          <DialogFooter className="items-center">
            {footerInfo !== undefined && (
              <div className="min-w-0 flex-1 text-body3 text-foreground-tertiary">
                {footerInfo}
              </div>
            )}
            <div className="flex shrink-0 items-center gap-2">
              {onReset !== undefined && (
                <Button type="button" variant="ghost" size="md" onClick={onReset}>
                  {resetLabel}
                </Button>
              )}
              <DialogClose asChild>
                <Button type="button" variant="border" size="md">
                  {cancelLabel}
                </Button>
              </DialogClose>
              {onSave !== undefined && (
                <Button
                  type="button"
                  variant={saveTone === 'danger' ? 'destructive' : 'primary'}
                  size="md"
                  onClick={onSave}
                  disabled={saveDisabled}
                >
                  {saveLabel}
                </Button>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
