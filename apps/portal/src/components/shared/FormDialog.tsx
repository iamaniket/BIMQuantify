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
  description: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  submitLabel?: string;
  cancelLabel?: string;
  submitDisabled?: boolean;
  children: ReactNode;
  width?: number;
  height?: number;
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
  height,
}: Props): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100vh-48px)] max-w-none flex-col"
        style={{ width, height, maxWidth: 'calc(100vw - 48px)' }}
      >
        <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <DialogBody className="min-h-0 flex-1 overflow-y-auto">
            {children}
          </DialogBody>

          <DialogFooter className="justify-between">
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
