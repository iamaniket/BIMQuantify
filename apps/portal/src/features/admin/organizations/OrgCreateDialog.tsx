'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { AppDialog, Input, Label } from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import { useCreateOrganization } from './useCreateOrganization';

const FormSchema = z.object({
  name: z.string().min(1).max(255),
  admin_email: z.string().email(),
  admin_full_name: z.string().max(255).optional().or(z.literal('')),
  seat_limit: z.string().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof FormSchema>;

const EMPTY: FormValues = {
  name: '',
  admin_email: '',
  admin_full_name: '',
  seat_limit: '',
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OrgCreateDialog({ open, onOpenChange }: Props): JSX.Element {
  const t = useTranslations('admin.organizations.create');
  const tCommon = useTranslations('admin.common');
  const mutation = useCreateOrganization();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: EMPTY,
  });

  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) {
      resetForm(EMPTY);
      resetMutation();
    }
  }, [open, resetForm, resetMutation]);

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    const parsedLimit = values.seat_limit === '' || values.seat_limit === undefined
      ? null
      : Number(values.seat_limit);
    if (parsedLimit !== null && (Number.isNaN(parsedLimit) || parsedLimit < 1)) {
      form.setError('seat_limit', { message: t('errors.seatLimitInvalid') });
      return;
    }
    mutation.mutate(
      {
        name: values.name.trim(),
        admin_email: values.admin_email.trim().toLowerCase(),
        admin_full_name:
          values.admin_full_name === undefined || values.admin_full_name === ''
            ? undefined
            : values.admin_full_name.trim(),
        seat_limit: parsedLimit,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            form.setError('name', { message: t('errors.nameTaken') });
          }
        },
      },
    );
  };

  return (
    <AppDialog
      open={open}
      onClose={() => { onOpenChange(false); }}
      eyebrow={tCommon('eyebrowSuperAdmin')}
      title={t('title')}
      subtitle={t('subtitle')}
      onSave={form.handleSubmit(onSubmit)}
      saveLabel={t('submit')}
      saveDisabled={mutation.isPending}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-name">{t('fields.name')}</Label>
          <Input
            id="org-name"
            placeholder={t('placeholders.name')}
            autoFocus
            {...form.register('name')}
          />
          {form.formState.errors.name && (
            <p className="text-caption text-error">{form.formState.errors.name.message}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-admin-email">{t('fields.adminEmail')}</Label>
          <Input
            id="org-admin-email"
            type="email"
            placeholder={t('placeholders.adminEmail')}
            {...form.register('admin_email')}
          />
          {form.formState.errors.admin_email && (
            <p className="text-caption text-error">
              {form.formState.errors.admin_email.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-admin-name">{t('fields.adminFullName')}</Label>
          <Input
            id="org-admin-name"
            placeholder={t('placeholders.adminFullName')}
            {...form.register('admin_full_name')}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-seat-limit">{t('fields.seatLimit')}</Label>
          <Input
            id="org-seat-limit"
            type="number"
            min={1}
            inputMode="numeric"
            placeholder={t('placeholders.seatLimit')}
            {...form.register('seat_limit')}
          />
          <p className="text-caption text-foreground-tertiary">{t('hints.seatLimit')}</p>
          {form.formState.errors.seat_limit && (
            <p className="text-caption text-error">
              {form.formState.errors.seat_limit.message}
            </p>
          )}
        </div>
      </div>
    </AppDialog>
  );
}
