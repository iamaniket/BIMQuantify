'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { AppDialog, Input } from '@bimstitch/ui';

import { Field } from '@/components/shared/forms/Field';
import { useRegisterField } from '@/hooks/useRegisterField';
import { ApiError } from '@/lib/api/client';
import type { AccessRequestRead } from '@/lib/api/schemas';

import { useApproveAccessRequest } from './useAccessRequestActions';

const FormSchema = z.object({
  org_name: z.string().min(1).max(255),
  seat_limit: z.string().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof FormSchema>;

type Props = {
  request: AccessRequestRead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AccessRequestApproveDialog({ request, open, onOpenChange }: Props): JSX.Element {
  const t = useTranslations('admin.accessRequests.approve');
  const tCommon = useTranslations('admin.common');
  const mutation = useApproveAccessRequest();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { org_name: '', seat_limit: '3' },
  });

  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;

  useEffect(() => {
    if (open && request !== null) {
      resetForm({
        org_name: request.company,
        seat_limit: '3',
      });
      resetMutation();
    }
  }, [open, request, resetForm, resetMutation]);

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    if (request === null) return;
    const parsedLimit = values.seat_limit === '' || values.seat_limit === undefined
      ? undefined
      : Number(values.seat_limit);
    if (parsedLimit !== undefined && (Number.isNaN(parsedLimit) || parsedLimit < 1)) {
      form.setError('seat_limit', { message: t('errors.seatLimitInvalid') });
      return;
    }
    mutation.mutate(
      {
        id: request.id,
        org_name: values.org_name.trim(),
        seat_limit: parsedLimit ?? null,
      },
      {
        onSuccess: () => {
          toast.success(t('success', { org: values.org_name.trim() }));
          onOpenChange(false);
        },
        onError: (err) => {
          // Surface the org-name collision inline on the input so the admin
          // can fix it in place instead of guessing from a toast. All other
          // errors fall through to the global mutation toast.
          if (
            err instanceof ApiError
            && err.status === 409
            && err.detailObject?.['code'] === 'ORG_NAME_TAKEN'
          ) {
            form.setError('org_name', { message: t('errors.orgNameTaken') });
            return;
          }
          throw err;
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
      subtitle={request !== null
        ? t('subtitle', { name: request.name, email: request.work_email })
        : ''}
      onSave={form.handleSubmit(onSubmit)}
      saveLabel={t('submit')}
      saveDisabled={mutation.isPending}
    >
      <div className="flex flex-col gap-4">
        <Field form={form} name="org_name" label={t('fields.orgName')}>
          {({ id }) => (
            <Input
              id={id}
              placeholder={t('placeholders.orgName')}
              autoFocus
              {...useRegisterField(form, 'org_name')}
            />
          )}
        </Field>
        <Field
          form={form}
          name="seat_limit"
          label={t('fields.seatLimit')}
          hint={t('hints.seatLimit')}
        >
          {({ id }) => (
            <Input
              id={id}
              type="number"
              min={1}
              inputMode="numeric"
              placeholder={t('placeholders.seatLimit')}
              {...useRegisterField(form, 'seat_limit')}
            />
          )}
        </Field>
      </div>
    </AppDialog>
  );
}
