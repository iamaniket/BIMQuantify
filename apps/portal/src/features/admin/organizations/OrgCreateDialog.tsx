'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useEffect, useRef, useState, type JSX,
} from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { AppDialog, Input } from '@bimstitch/ui';

import { Field } from '@/components/forms/Field';
import { useRegisterField } from '@/hooks/useRegisterField';
import { lookupUserByEmail } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type { AdminUserRead } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

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

// Quick check before we burn an API round-trip on every keystroke.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OrgCreateDialog({ open, onOpenChange }: Props): JSX.Element {
  const t = useTranslations('admin.organizations.create');
  const tCommon = useTranslations('admin.common');
  const mutation = useCreateOrganization();
  const { tokens } = useAuth();
  const accessToken = tokens?.access_token;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: EMPTY,
  });

  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;

  // Tracks the user found by the email lookup. When set, the form shows a
  // banner explaining the existing user will be attached as admin.
  const [existingUser, setExistingUser] = useState<AdminUserRead | null>(null);
  const [lookupPending, setLookupPending] = useState(false);
  // Whether the operator has manually typed in the full-name field. We only
  // auto-fill if they haven't, so we never clobber their input.
  const fullNameTouchedRef = useRef(false);

  useEffect(() => {
    if (open) {
      resetForm(EMPTY);
      resetMutation();
      setExistingUser(null);
      setLookupPending(false);
      fullNameTouchedRef.current = false;
    }
  }, [open, resetForm, resetMutation]);

  // Debounced lookup whenever the email field stabilises on a syntactically
  // valid email. We accept the result only if the email hasn't changed in
  // the meantime (handles fast typing).
  const emailValue = form.watch('admin_email').trim().toLowerCase();
  useEffect(() => {
    if (accessToken === undefined) return undefined;
    if (!open) return undefined;
    if (!EMAIL_RE.test(emailValue)) {
      setExistingUser(null);
      setLookupPending(false);
      return undefined;
    }
    let cancelled = false;
    setLookupPending(true);
    const handle = setTimeout(() => {
      lookupUserByEmail(accessToken, emailValue)
        .then((found) => {
          if (cancelled) return;
          setExistingUser(found);
          // Only pre-fill if the operator hasn't typed anything yet.
          if (found !== null && !fullNameTouchedRef.current) {
            if (found.full_name !== null && found.full_name.length > 0) {
              form.setValue('admin_full_name', found.full_name, {
                shouldDirty: false,
                shouldTouch: false,
                shouldValidate: false,
              });
            }
          }
        })
        .catch(() => {
          // Swallow — failing the lookup must not break the create flow.
          // The operator can still submit.
        })
        .finally(() => {
          if (!cancelled) setLookupPending(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [accessToken, emailValue, form, open]);

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
        <Field form={form} name="name" label={t('fields.name')}>
          {({ id }) => (
            <Input
              id={id}
              placeholder={t('placeholders.name')}
              autoFocus
              {...useRegisterField(form, 'name')}
            />
          )}
        </Field>
        <Field form={form} name="admin_email" label={t('fields.adminEmail')}>
          {({ id }) => (
            <>
              <Input
                id={id}
                type="email"
                placeholder={t('placeholders.adminEmail')}
                {...useRegisterField(form, 'admin_email')}
              />
              {lookupPending && (
                <p className="text-caption text-foreground-tertiary">
                  {t('existingUser.checking')}
                </p>
              )}
              {existingUser !== null && (
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-md border border-info-light bg-info-lighter px-3 py-2 text-body3 text-info"
                >
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    {t('existingUser.banner', {
                      name: existingUser.full_name ?? existingUser.email,
                    })}
                  </span>
                </div>
              )}
            </>
          )}
        </Field>
        <Field
          form={form}
          name="admin_full_name"
          label={t('fields.adminFullName')}
          action={existingUser !== null ? (
            <span className="text-caption font-normal text-foreground-tertiary">
              {t('existingUser.nameLocked')}
            </span>
          ) : undefined}
        >
          {({ id }) => (
            <Input
              id={id}
              placeholder={t('placeholders.adminFullName')}
              readOnly={existingUser !== null}
              {...useRegisterField(form, 'admin_full_name', {
                onChange: () => {
                  fullNameTouchedRef.current = true;
                },
              })}
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
