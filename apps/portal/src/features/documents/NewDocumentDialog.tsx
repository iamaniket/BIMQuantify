'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { useTranslations } from 'next-intl';

import {
  Input,
  Select,
} from '@bimdossier/ui';

import { FormDialog } from '@/components/shared/FormDialog';
import { Field } from '@/components/shared/forms/Field';
import { registerField } from '@/hooks/registerField';
import { ApiError } from '@/lib/api/client';
import { DISCIPLINE_OPTIONS, STATUS_OPTIONS } from '@/lib/formatting/models';
import {
  createDocumentFormSchema,
  type DocumentFormValues,
} from './documentFormSchema';
import { useCreateDocument } from './useCreateDocument';

const DEFAULTS: DocumentFormValues = {
  name: '',
  // "other" → the processor auto-detects from content (a real arch model still
  // gets a plan via the wall/room envelope). The user can pick a specific
  // discipline to force the plan on (architectural/coordination) or off
  // (structural/mep).
  discipline: 'other',
  status: 'active',
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
};

export function NewDocumentDialog({ open, onOpenChange, projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.documents.newDocumentDialog');
  // Reuse the inline discipline selector's labels (field + options) so the two
  // entry points stay in lockstep — no duplicate i18n keys.
  const tDiscipline = useTranslations('projectDetail.tabs.documents.assignDiscipline');
  const createMutation = useCreateDocument();
  const { reset: resetMutation } = createMutation;

  const schema = useMemo(() => createDocumentFormSchema(t), [t]);

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(schema),
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
              {...registerField(form, 'name')}
            />
          )}
        </Field>

        <Field form={form} name="discipline" label={tDiscipline('label')}>
          {({ id }) => (
            <Select
              id={id}
              disabled={isSubmitting}
              {...registerField(form, 'discipline')}
            >
              {DISCIPLINE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {tDiscipline(`options.${opt.value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field form={form} name="status" label={t('fields.status')}>
          {({ id }) => (
            <Select
              id={id}
              disabled={isSubmitting}
              {...registerField(form, 'status')}
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
