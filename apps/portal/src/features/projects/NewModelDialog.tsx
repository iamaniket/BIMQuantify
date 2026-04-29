'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';

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
  Label,
} from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';

import { DISCIPLINE_OPTIONS, STATUS_OPTIONS } from './modelFormatting';
import {
  ModelFormSchema,
  type ModelFormValues,
} from './modelFormSchema';
import { useCreateModel } from './useCreateModel';

const DEFAULTS: ModelFormValues = {
  name: '',
  discipline: 'architectural',
  status: 'active',
};

const SELECT_CLASS = 'h-10 w-full rounded-md border border-border bg-background px-3 text-[14px] '
  + 'text-foreground transition-colors hover:border-border-hover '
  + 'focus:outline-none focus:ring-2 focus:ring-ring '
  + 'disabled:cursor-not-allowed disabled:bg-background-tertiary disabled:text-foreground-disabled';

function formatApiError(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'A model with that name already exists in this project.';
    }
    if (error.status === 403) {
      return 'You do not have permission to create models in this project.';
    }
    return `Create failed: ${error.detail}`;
  }
  return 'Could not create model.';
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
};

export function NewModelDialog({ open, onOpenChange, projectId }: Props): JSX.Element {
  const nameId = useId();
  const disciplineId = useId();
  const statusId = useId();

  const createMutation = useCreateModel();
  const { reset: resetMutation } = createMutation;

  const form = useForm<ModelFormValues>({
    resolver: zodResolver(ModelFormSchema),
    defaultValues: DEFAULTS,
    mode: 'onSubmit',
  });

  const { reset: resetForm } = form;

  useEffect(() => {
    if (!open) return;
    resetForm(DEFAULTS);
    resetMutation();
  }, [open, resetForm, resetMutation]);

  const onSubmit: SubmitHandler<ModelFormValues> = (values) => {
    createMutation.mutate(
      { projectId, input: values },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            form.setError('name', { type: 'server', message: 'This name is taken' });
          }
        },
      },
    );
  };

  const apiErrorMessage = formatApiError(createMutation.error);
  const nameFieldError = form.formState.errors.name;
  const nameError = nameFieldError === undefined ? undefined : nameFieldError.message;
  const isSubmitting = createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>New model</DialogTitle>
            <DialogDescription>
              Group IFC versions by discipline. You can upload an IFC into the
              model after creating it.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={nameId}>Name</Label>
              <Input
                id={nameId}
                type="text"
                autoComplete="off"
                autoFocus
                invalid={nameError !== undefined}
                {...form.register('name', {
                  onChange: () => {
                    const currentNameError = form.formState.errors.name;
                    if (currentNameError === undefined) return;
                    if (currentNameError.type === 'server') {
                      form.clearErrors('name');
                    }
                  },
                })}
              />
              {nameError === undefined ? null : (
                <span role="alert" className="text-body3 text-error">
                  {nameError}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={disciplineId}>Discipline</Label>
              <select
                id={disciplineId}
                className={SELECT_CLASS}
                disabled={isSubmitting}
                {...form.register('discipline')}
              >
                {DISCIPLINE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={statusId}>Status</Label>
              <select
                id={statusId}
                className={SELECT_CLASS}
                disabled={isSubmitting}
                {...form.register('status')}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {apiErrorMessage === null ? null : (
              <div
                role="alert"
                className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-body3 text-error"
              >
                {apiErrorMessage}
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="border" size="md" disabled={isSubmitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" size="md" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
