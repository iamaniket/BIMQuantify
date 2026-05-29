'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import {
  AppDialog,
  Input,
  Select,
  Textarea,
} from '@bimstitch/ui';

import { Field } from '@/components/shared/forms/Field';
import { useCreateFinding } from '@/features/findings/useCreateFinding';
import { useRegisterField } from '@/hooks/useRegisterField';

const SEVERITIES = ['low', 'medium', 'high'] as const;

const FormSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(4000),
  severity: z.enum(SEVERITIES),
  bbl_article_ref: z.string().max(50).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof FormSchema>;

const EMPTY: FormValues = {
  title: '',
  description: '',
  severity: 'medium',
  bbl_article_ref: '',
};

type Props = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // When opened from the viewer (#49) the new finding is pre-linked to the
  // selected IFC element so it round-trips to the 3D model.
  linkedFileId?: string | null;
  linkedElementGlobalId?: string | null;
};

export function FindingFormDialog({
  projectId,
  open,
  onOpenChange,
  linkedFileId,
  linkedElementGlobalId,
}: Props): JSX.Element {
  const t = useTranslations('findings.form');
  const tSeverity = useTranslations('findings.severity');
  const mutation = useCreateFinding(projectId);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: EMPTY,
  });

  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;

  const titleField = useRegisterField(form, 'title');
  const descriptionField = useRegisterField(form, 'description');
  const severityField = useRegisterField(form, 'severity');
  const bblField = useRegisterField(form, 'bbl_article_ref');

  useEffect(() => {
    if (open) {
      resetForm(EMPTY);
      resetMutation();
    }
  }, [open, resetForm, resetMutation]);

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    mutation.mutate(
      {
        title: values.title.trim(),
        description: values.description.trim(),
        severity: values.severity,
        bbl_article_ref:
          values.bbl_article_ref === undefined || values.bbl_article_ref === ''
            ? null
            : values.bbl_article_ref.trim(),
        linked_file_id: linkedFileId === undefined ? null : linkedFileId,
        linked_element_global_id:
          linkedElementGlobalId === undefined ? null : linkedElementGlobalId,
      },
      {
        onSuccess: () => { onOpenChange(false); },
      },
    );
  };

  return (
    <AppDialog
      open={open}
      onClose={() => { onOpenChange(false); }}
      title={t('createTitle')}
      subtitle={t('createSubtitle')}
      onSave={form.handleSubmit(onSubmit)}
      saveLabel={t('submit')}
      saveDisabled={mutation.isPending}
    >
      <div className="flex flex-col gap-4">
        <Field form={form} name="title" label={t('fields.title')}>
          {({ id }) => (
            <Input
              id={id}
              placeholder={t('placeholders.title')}
              autoFocus
              {...titleField}
            />
          )}
        </Field>
        <Field form={form} name="description" label={t('fields.description')}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={4}
              placeholder={t('placeholders.description')}
              {...descriptionField}
            />
          )}
        </Field>
        <Field form={form} name="severity" label={t('fields.severity')}>
          {({ id }) => (
            <Select id={id} {...severityField}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{tSeverity(s)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          form={form}
          name="bbl_article_ref"
          label={t('fields.bblArticleRef')}
          hint={t('hints.bblArticleRef')}
        >
          {({ id }) => (
            <Input
              id={id}
              placeholder={t('placeholders.bblArticleRef')}
              {...bblField}
            />
          )}
        </Field>
      </div>
    </AppDialog>
  );
}
