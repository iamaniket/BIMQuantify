'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { z } from 'zod';

import { Input } from '@bimdossier/ui';

import { FormDialog } from '@/components/shared/FormDialog';
import { Field } from '@/components/shared/forms/Field';
import { useRegisterField } from '@/hooks/useRegisterField';
import { ApiError } from '@/lib/api/client';

import { useCreateLevel } from './hooks';

const LevelFormSchema = z.object({
  name: z.string().min(1).max(255),
  // Free-text so the input can be left blank; coerced to number|null on submit.
  elevation_m: z.string().optional(),
});

type LevelFormValues = z.infer<typeof LevelFormSchema>;

const DEFAULTS: LevelFormValues = { name: '', elevation_m: '' };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
};

export function NewLevelDialog({ open, onOpenChange, projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.documents.newLevelDialog');
  const createMutation = useCreateLevel();
  const { reset: resetMutation } = createMutation;

  const form = useForm<LevelFormValues>({
    resolver: zodResolver(LevelFormSchema),
    defaultValues: DEFAULTS,
    mode: 'onSubmit',
  });
  const { reset: resetForm } = form;

  useEffect(() => {
    if (!open) return;
    resetForm(DEFAULTS);
    resetMutation();
  }, [open, resetForm, resetMutation]);

  const onSubmit: SubmitHandler<LevelFormValues> = (values) => {
    const raw = values.elevation_m?.trim() ?? '';
    const parsed = raw === '' ? null : Number(raw);
    const elevation_m = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    createMutation.mutate(
      { projectId, input: { name: values.name, elevation_m } },
      {
        onSuccess: () => { onOpenChange(false); },
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

        <Field form={form} name="elevation_m" label={t('fields.elevation')}>
          {({ id }) => (
            <Input
              id={id}
              type="number"
              step="any"
              inputMode="decimal"
              placeholder={t('fields.elevationPlaceholder')}
              disabled={isSubmitting}
              {...useRegisterField(form, 'elevation_m')}
            />
          )}
        </Field>
      </div>
    </FormDialog>
  );
}
