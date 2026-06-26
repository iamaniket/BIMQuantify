'use client';

import {
  useCallback,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@bimdossier/ui';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  onConfirm: () => void;
  isPending: boolean;
  errorMessage: string | null | undefined;
};

/**
 * Type-to-confirm removal dialog: the user must re-type the project name before the
 * destructive Remove button enables. A double-confirmation so an accidental delete
 * cannot happen. Match is trimmed + case-sensitive (GitHub-style).
 */
export function RemoveProjectDialog({
  open,
  onOpenChange,
  projectName,
  onConfirm,
  isPending,
  errorMessage,
}: Props): JSX.Element {
  const t = useTranslations('projects.card.menu');
  const [confirmText, setConfirmText] = useState('');
  const canConfirm = confirmText.trim() === projectName.trim() && !isPending;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setConfirmText('');
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !canConfirm) return;
      e.preventDefault();
      onConfirm();
    },
    [canConfirm, onConfirm],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>{t('deleteDescription', { name: projectName })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {errorMessage === null || errorMessage === undefined ? null : (
            <div
              role="alert"
              className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-body3 text-error"
            >
              {errorMessage}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="remove-project-confirm"
              className="text-body3 text-foreground-secondary"
            >
              {t('deleteConfirmPrompt', { name: projectName })}
            </label>
            <Input
              id="remove-project-confirm"
              value={confirmText}
              onChange={(e) => {
                setConfirmText(e.target.value);
              }}
              placeholder={t('deleteConfirmPlaceholder')}
              autoComplete="off"
            />
          </div>
        </DialogBody>
        <DialogFooter className="justify-between">
          <DialogClose asChild>
            <Button type="button" variant="border" size="md" disabled={isPending}>
              {t('cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            size="md"
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {isPending ? `${t('deleteConfirm')}…` : t('deleteConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
