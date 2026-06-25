'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { useTranslations } from 'next-intl';

import {
  Input,
  Select,
} from '@bimdossier/ui';

import { FormDialog } from '@/components/shared/FormDialog';
import { Field } from '@/components/shared/forms/Field';
import { useRegisterField } from '@/hooks/useRegisterField';
import { ApiError } from '@/lib/api/client';
import { STATUS_OPTIONS } from '@/lib/formatting/models';
import {
  DocumentFormSchema,
  type DocumentFormValues,
} from './documentFormSchema';
import { useCreateDocument } from './useCreateDocument';

const DEFAULTS: DocumentFormValues = {
  name: '',
  status: 'active',
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
};

export function NewDocumentDialog({ open, onOpenChange, projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.documents.newDocumentDialog');
  const createMutation = useCreateDocument();
  const { reset: resetMutation } = createMutation;

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(DocumentFormSchema),
    defaultValues: DEFAULTS,
    mode: 'onSubmit',
  });

  const { reset: resetForm } = form;

  useEffect(() => {
    if (!open) return;
    resetForm(DEFAULTS);
    resetMutation();
  }, [open, resetForm, resetMutation]);

  const onSubmit: SubmitHandler<DocumentFormValues> = (values) => {
    createMutation.mutate(
      { projectId, input: values },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            form.setError('name', { type: 'server', message: t('errors.nameTaken') });
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
      title={t('title')}
      description={t('description')}
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isSubmitting ? t('submitCreating') : t('submitCreate')}
      cancelLabel={t('cancel')}
      submitDisabled={isSubmitting}
    >
      <div className="flex flex-col gap-4">
        <Field form={form} name="name" label={t('fields.name')}>
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

        <Field form={form} name="status" label={t('fields.status')}>
          {({ id }) => (
            <Select
              id={id}
              disabled={isSubmitting}
              {...useRegisterField(form, 'status')}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(`statuses.${opt.value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </FormDialog>
  );
}
