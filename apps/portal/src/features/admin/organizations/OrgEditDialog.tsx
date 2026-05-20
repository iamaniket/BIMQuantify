'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { AppDialog, Input, Select } from '@bimstitch/ui';

import { Field } from '@/components/forms/Field';
import { ApiError } from '@/lib/api/client';
import type { OrganizationRead } from '@/lib/api/schemas';

import { useUpdateOrganization } from './useUpdateOrganization';

const FormSchema = z.object({
  name: z.string().min(1).max(255),
  status: z.enum(['active', 'suspended']),
  seat_limit: z.string(),
});

type FormValues = z.infer<typeof FormSchema>;

type Props = {
  organization: OrganizationRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function toFormValues(org: OrganizationRead): FormValues {
  return {
    name: org.name,
    status: (org.status === 'suspended' ? 'suspended' : 'active'),
    seat_limit: org.seat_limit === null ? '' : String(org.seat_limit),
  };
}

export function OrgEditDialog({ organization, open, onOpenChange }: Props): JSX.Element {
  const t = useTranslations('admin.organizations.edit');
  const tCommon = useTranslations('admin.common');
  const mutation = useUpdateOrganization();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toFormValues(organization),
  });

  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) {
      resetForm(toFormValues(organization));
      resetMutation();
    }
  }, [open, organization, resetForm, resetMutation]);

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    let parsedLimit: number | null;
    if (values.seat_limit === '') {
      parsedLimit = null;
    } else {
      const n = Number(values.seat_limit);
      if (Number.isNaN(n) || n < 1) {
        form.setError('seat_limit', { message: t('errors.seatLimitInvalid') });
        return;
      }
      parsedLimit = n;
    }

    mutation.mutate(
      {
        id: organization.id,
        input: {
          name: values.name.trim(),
          status: values.status,
          seat_limit: parsedLimit,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            if (error.detail === 'SEAT_LIMIT_BELOW_USAGE') {
              form.setError('seat_limit', {
                message: t('errors.seatLimitBelowUsage', {
                  used: organization.seat_count_used,
                }),
              });
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
      eyebrow={tCommon('eyebrowSuperAdmin')}
      title={t('title')}
      subtitle={t('subtitle')}
      onSave={form.handleSubmit(onSubmit)}
      saveLabel={t('submit')}
      saveDisabled={mutation.isPending}
    >
      <div className="flex flex-col gap-4">
        <Field form={form} name="name" label={t('fields.name')}>
          {({ id }) => <Input id={id} autoFocus {...form.register('name')} />}
        </Field>
        <Field form={form} name="status" label={t('fields.status')}>
          {({ id }) => (
            <Select id={id} {...form.register('status')}>
              <option value="active">{t('statuses.active')}</option>
              <option value="suspended">{t('statuses.suspended')}</option>
            </Select>
          )}
        </Field>
        <Field
          form={form}
          name="seat_limit"
          label={t('fields.seatLimit')}
          hint={t('hints.seatLimit', { used: organization.seat_count_used })}
        >
          {({ id }) => (
            <Input
              id={id}
              type="number"
              min={1}
              inputMode="numeric"
              {...form.register('seat_limit')}
            />
          )}
        </Field>
      </div>
    </AppDialog>
  );
}
