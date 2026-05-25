import { X } from 'lucide-react';
import {
  type FormEventHandler, type JSX, type ReactNode,
} from 'react';

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
} from '@bimstitch/ui';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  submitLabel?: string;
  cancelLabel?: string;
  submitDisabled?: boolean;
  children: ReactNode;
  width?: number;
};

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  submitDisabled = false,
  children,
  width = 520,
}: Props): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100vh-48px)] max-w-none flex-col"
        style={{ width, maxWidth: 'calc(100vw - 48px)' }}
      >
        <form noValidate onSubmit={onSubmit}>
          <DialogHeader className="relative flex-row items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <DialogTitle>{title}</DialogTitle>
              {description !== undefined && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </div>
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

          <DialogBody className="min-h-0 flex-1 overflow-y-auto">
            {children}
          </DialogBody>

          <DialogFooter>
            <div className="flex shrink-0 items-center gap-2">
              <DialogClose asChild>
                <Button type="button" variant="border" size="md">
                  {cancelLabel}
                </Button>
              </DialogClose>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={submitDisabled}
              >
                {submitLabel}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
