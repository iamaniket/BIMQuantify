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
  orgName: string;
  onConfirm: () => void;
  isPending: boolean;
  errorMessage: string | null | undefined;
};

/**
 * Type-to-confirm permanent-removal dialog for a soft-deleted org. The super-admin
 * must re-type the org name before the destructive button enables — purge is
 * irreversible (storage wiped + tenant schema dropped). Match is trimmed +
 * case-sensitive (GitHub-style).
 */
export function PurgeOrgDialog({
  open,
  onOpenChange,
  orgName,
  onConfirm,
  isPending,
  errorMessage,
}: Props): JSX.Element {
  const t = useTranslations('admin.organizations.purge');
  const [confirmText, setConfirmText] = useState('');
  const canConfirm = confirmText.trim() === orgName.trim() && !isPending;

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
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { name: orgName })}</DialogDescription>
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
              htmlFor="purge-org-confirm"
              className="text-body3 text-foreground-secondary"
            >
              {t('confirmPrompt', { name: orgName })}
            </label>
            <Input
              id="purge-org-confirm"
              value={confirmText}
              onChange={(e) => {
                setConfirmText(e.target.value);
              }}
              placeholder={orgName}
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
            {isPending ? `${t('confirm')}…` : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
