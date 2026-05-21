'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { JSX } from 'react';
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
  Select,
} from '@bimstitch/ui';

import { Field } from '@/components/forms/Field';
import { useFormDialog } from '@/hooks/useFormDialog';
import { ApiError } from '@/lib/api/client';
import { DISCIPLINE_OPTIONS, STATUS_OPTIONS } from '@/lib/formatting/models';
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

function formatApiError(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'A document with that name already exists in this project.';
    }
    if (error.status === 403) {
      return 'You do not have permission to create documents in this project.';
    }
    return `Create failed: ${error.detail}`;
  }
  return 'Could not create document.';
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
};

export function NewModelDialog({ open, onOpenChange, projectId }: Props): JSX.Element {
  const createMutation = useCreateModel();

  const form = useForm<ModelFormValues>({
    resolver: zodResolver(ModelFormSchema),
    defaultValues: DEFAULTS,
    mode: 'onSubmit',
  });

  useFormDialog(open, form, createMutation, DEFAULTS);

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

  const isSubmitting = createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>New document</DialogTitle>
            <DialogDescription>
              Group file versions by discipline. You can upload a file into the
              document after creating it.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <Field form={form} name="name" label="Name">
              {({ id, invalid }) => (
                <Input
                  id={id}
                  type="text"
                  autoComplete="off"
                  autoFocus
                  invalid={invalid}
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
              )}
            </Field>

            <Field form={form} name="discipline" label="Discipline">
              {({ id }) => (
                <Select
                  id={id}
                  disabled={isSubmitting}
                  {...form.register('discipline')}
                >
                  {DISCIPLINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field form={form} name="status" label="Status">
              {({ id }) => (
                <Select
                  id={id}
                  disabled={isSubmitting}
                  {...form.register('status')}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

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
