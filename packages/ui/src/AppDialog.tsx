'use client';

import { useCallback, type JSX, type KeyboardEvent, type ReactNode } from 'react';

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
  subtitle: string;
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
  height?: number;
  className?: string;
  bodyClassName?: string;
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
  height,
  className,
  bodyClassName,
}: AppDialogProps): JSX.Element {
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) onClose();
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (e.target instanceof HTMLTextAreaElement) return;
      if (onSave === undefined || saveDisabled) return;
      e.preventDefault();
      onSave();
    },
    [onSave, saveDisabled],
  );

  const hasFooter =
    footerInfo !== undefined || onSave !== undefined || onReset !== undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn('flex max-w-none flex-col max-h-[calc(100vh-48px)]', className)}
        style={{ width, height, maxWidth: 'calc(100vw - 48px)' }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <DialogHeader>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {eyebrow !== undefined && (
              <span className="text-caption font-bold uppercase tracking-[0.14em] text-primary">
                {eyebrow}
              </span>
            )}
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
          </div>
          {headerMeta !== undefined && (
            <div className="shrink-0">{headerMeta}</div>
          )}
        </DialogHeader>

        {/* Body */}
        <DialogBody className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName)}>
          {children}
        </DialogBody>

        {/* Footer */}
        {hasFooter && (
          <DialogFooter className="items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <DialogClose asChild>
                <Button type="button" variant="border" size="md">
                  {cancelLabel}
                </Button>
              </DialogClose>
              {onReset !== undefined && (
                <Button type="button" variant="ghost" size="md" onClick={onReset}>
                  {resetLabel}
                </Button>
              )}
              {footerInfo !== undefined && (
                <div className="min-w-0 text-body3 text-foreground-tertiary">
                  {footerInfo}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
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
