'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { AppDialog, Input, Label } from '@bimstitch/ui';

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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">{t('fields.email')}</Label>
          <Input
            id="invite-email"
            type="email"
            autoFocus
            placeholder={t('placeholders.email')}
            {...form.register('email')}
          />
          {form.formState.errors.email && (
            <p className="text-caption text-error">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-full-name">{t('fields.fullName')}</Label>
          <Input
            id="invite-full-name"
            placeholder={t('placeholders.fullName')}
            {...form.register('full_name')}
          />
        </div>
        <label className="flex items-center gap-2 text-body3">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border border-border"
            {...form.register('is_org_admin')}
          />
          <span>{t('fields.isOrgAdmin')}</span>
        </label>
      </div>
    </AppDialog>
  );
}
