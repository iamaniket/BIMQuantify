'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { AppDialog, Checkbox, Input } from '@bimstitch/ui';

import { Field } from '@/components/shared/forms/Field';
import { useRegisterField } from '@/hooks/useRegisterField';
import { ApiError } from '@/lib/api/client';
import { useInviteMember } from './useInviteMember';

const FormSchema = z.object({
  email: z.string().email(),
  full_name: z.string().max(255).optional().or(z.literal('')),
  is_org_admin: z.boolean().optional(),
});

type FormValues = z.infer<typeof FormSchema>;

const EMPTY: FormValues = {
  email: '',
  full_name: '',
  is_org_admin: false,
};

type Props = {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function InviteMemberDialog({
  organizationId,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('admin.members.invite');
  const mutation = useInviteMember();

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
    mutation.mutate(
      {
        organizationId,
        input: {
          email: values.email.trim().toLowerCase(),
          full_name:
            values.full_name === undefined || values.full_name === ''
              ? undefined
              : values.full_name.trim(),
          is_org_admin: values.is_org_admin ?? false,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            if (error.detail === 'SEAT_LIMIT_EXCEEDED') {
              form.setError('email', { message: t('errors.seatLimitExceeded') });
            } else if (error.detail === 'ORG_MEMBER_ALREADY_EXISTS') {
              form.setError('email', { message: t('errors.alreadyMember') });
            }
          }
        },
      },
    );
  };

  return (
    <AppDialog
      open={open}
      onClose={() => { onOpenChange(false); }}
      title={t('title')}
      subtitle={t('subtitle')}
      onSave={form.handleSubmit(onSubmit)}
      saveLabel={t('submit')}
      saveDisabled={mutation.isPending}
    >
      <div className="flex flex-col gap-4">
        <Field form={form} name="email" label={t('fields.email')}>
          {({ id }) => (
            <Input
              id={id}
              type="email"
              autoFocus
              placeholder={t('placeholders.email')}
              {...useRegisterField(form, 'email')}
            />
          )}
        </Field>
        <Field form={form} name="full_name" label={t('fields.fullName')}>
          {({ id }) => (
            <Input
              id={id}
              placeholder={t('placeholders.fullName')}
              {...useRegisterField(form, 'full_name')}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-body3">
          <Checkbox {...form.register('is_org_admin')} />
          <span>{t('fields.isOrgAdmin')}</span>
        </label>
      </div>
    </AppDialog>
  );
}
