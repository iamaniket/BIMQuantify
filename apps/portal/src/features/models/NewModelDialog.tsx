'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';

import {
  Input,
  Select,
} from '@bimstitch/ui';

import { FormDialog } from '@/components/shared/FormDialog';
import { Field } from '@/components/shared/forms/Field';
import { useRegisterField } from '@/hooks/useRegisterField';
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

  const isSubmitting = createMutation.isPending;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New document"
      description="Group file versions by discipline. You can upload a file into the document after creating it."
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isSubmitting ? 'Creating…' : 'Create'}
      submitDisabled={isSubmitting}
    >
      <div className="flex flex-col gap-4">
        <Field form={form} name="name" label="Name">
          {({ id, invalid }) => (
            <Input
              id={id}
              type="text"
              autoComplete="off"
              autoFocus
              invalid={invalid}
              {...useRegisterField(form, 'name')}
            />
          )}
        </Field>

        <Field form={form} name="discipline" label="Discipline">
          {({ id }) => (
            <Select
              id={id}
              disabled={isSubmitting}
              {...useRegisterField(form, 'discipline')}
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
              {...useRegisterField(form, 'status')}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </FormDialog>
  );
}
