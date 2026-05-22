"use client";

import { AuthFormIntro } from '@/features/auth/AuthFormIntro';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from '@/i18n/navigation';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { Button, FormField, Input } from '@bimstitch/ui';

import { useLogin } from '@/features/auth/useLogin';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/providers/AuthProvider';
import { getAuthMe } from '@/lib/api/organizations';

const EMPTY_DEFAULTS = { username: '', password: '' };
const DEV_DEFAULTS = {
  username: process.env['NEXT_PUBLIC_DEV_LOGIN_EMAIL'] ?? '',
  password: process.env['NEXT_PUBLIC_DEV_LOGIN_PASSWORD'] ?? '',
};

type LoginFormValues = { username: string; password: string };
type OrganizationMembership = { organization_id: string; organization_name: string };

export function LoginForm(): JSX.Element {
  const requestAccessHref = process.env['NEXT_PUBLIC_MARKETING_URL']
    ? `${process.env['NEXT_PUBLIC_MARKETING_URL'].replace(/\/$/, '')}/request-access`
    : '/request-access';
  const t = useTranslations('auth.login');
  const router = useRouter();
  const { setTokens, switchOrganization } = useAuth();
  const login = useLogin();
  const emailId = useId();
  const passwordId = useId();
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [authStep, setAuthStep] = useState<'credentials' | 'organization'>('credentials');
  const [memberships, setMemberships] = useState<OrganizationMembership[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [organizationError, setOrganizationError] = useState<string | null>(null);
  const [pendingInvitationsCount, setPendingInvitationsCount] = useState(0);

  const schema = useMemo(
    () =>
      z.object({
        username: z
          .string()
          .min(1, { message: t('errors.emailRequired') })
          .email({ message: t('errors.emailInvalid') }),
        password: z.string().min(1, { message: t('errors.passwordRequired') }),
      }),
    [t],
  );

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    defaultValues: process.env.NODE_ENV === 'production' ? EMPTY_DEFAULTS : DEV_DEFAULTS,
    mode: 'onSubmit',
  });

  const onSubmit: SubmitHandler<LoginFormValues> = (values) => {
    login.mutate(values, {
      onSuccess: async (tokens) => {
        setTokens(tokens);
        // Fetch memberships directly with the new access token
        try {
          const me = await getAuthMe(tokens.access_token);
          if (me && me.memberships && me.memberships.length > 1) {
            setMemberships(me.memberships.map((membership) => ({
              organization_id: membership.organization_id,
              organization_name: membership.organization_name,
            })));
            setPendingInvitationsCount(me.pending_invitations_count ?? 0);
            setOrganizationError(null);
            setSwitching(null);
            setAuthStep('organization');
          } else {
            router.push(me.pending_invitations_count > 0 ? '/account' : '/projects');
          }
        } catch {
          router.push('/projects');
        }
      },
    });
  };

  const apiErrorMessage = ((): string | null => {
    const { error } = login;
    if (error === null) return null;
    if (error instanceof ApiError) {
      if (error.status === 400 || error.status === 401) {
        return t('errors.invalidCredentials');
      }
      return t('errors.loginFailedDetail', { detail: error.detail });
    }
    return t('errors.loginFailedGeneric');
  })();

  const usernameField = form.formState.errors.username;
  const passwordField = form.formState.errors.password;
  const usernameError = usernameField === undefined ? undefined : usernameField.message;
  const passwordError = passwordField === undefined ? undefined : passwordField.message;

  const selectOrganization = async (organizationId: string): Promise<void> => {
    setSwitching(organizationId);
    setOrganizationError(null);

    try {
      await switchOrganization(organizationId);
      router.push(pendingInvitationsCount > 0 ? '/account' : '/projects');
    } catch {
      setOrganizationError(t('errors.organizationSwitchFailed'));
      setSwitching(null);
    }
  };

  return (
    <div className="w-full overflow-hidden">
      {authStep === 'credentials' && (
        <AuthFormIntro
          eyebrow={t('eyebrow')}
          heading={t('heading')}
          subtitle={(
            <>
              {t('intro')}{' '}
              <span className="whitespace-nowrap">
                {t('newHere')}{' '}
                <a href={requestAccessHref} className="font-semibold text-primary no-underline">
                  {t('requestAccessCta')}
                </a>
              </span>
            </>
          )}
        />
      )}
      <div
        className={`flex w-[200%] gap-4 transition-transform duration-300 ease-out ${authStep === 'organization' ? '-translate-x-1/2' : 'translate-x-0'}`}
      >
        <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex w-1/2 flex-col gap-3.5">
          <FormField label={t('emailLabel')} htmlFor={emailId} error={usernameError}>
            <Input
              id={emailId}
              type="email"
              autoComplete="email"
              placeholder={t('emailPlaceholder')}
              invalid={usernameError !== undefined}
              leading={<Mail size={14} />}
              {...form.register('username')}
            />
          </FormField>

          <FormField
            label={t('passwordLabel')}
            htmlFor={passwordId}
            error={passwordError}
            action={
              <a href="/forgot-password" className="text-[11px] font-semibold text-primary no-underline">
                {t('forgot')}
              </a>
            }
          >
            <Input
              id={passwordId}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder={t('passwordPlaceholder')}
              invalid={passwordError !== undefined}
              leading={<Lock size={14} />}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  suppressHydrationWarning
                  aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                  className="grid size-7 cursor-pointer place-items-center rounded text-foreground-tertiary hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
              {...form.register('password')}
            />
          </FormField>

          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              suppressHydrationWarning
              className="size-4 cursor-pointer accent-primary"
            />
            <span className="text-[12.5px] text-foreground-secondary">{t('rememberMe')}</span>
          </label>

          {apiErrorMessage === null ? null : (
            <div
              role="alert"
              className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-[12.5px] text-error"
            >
              {apiErrorMessage}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={login.isPending}
            className="mt-1 flex items-center justify-center gap-2"
          >
            {login.isPending ? t('submitting') : (
              <>
                {t('submit')}
                <ArrowRight size={14} />
              </>
            )}
          </Button>
        </form>

        <section className="flex w-1/2 flex-col gap-3.5">
          <header className="space-y-1">
            <h3 className="text-base font-semibold text-foreground">{t('organizationStep.title')}</h3>
            <p className="text-sm text-foreground-secondary">{t('organizationStep.subtitle')}</p>
          </header>

          <ul className="space-y-2">
            {memberships?.map((membership) => (
              <li key={membership.organization_id}>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  className="w-full justify-between"
                  disabled={switching !== null}
                  onClick={() => {
                    void selectOrganization(membership.organization_id);
                  }}
                >
                  <span>{membership.organization_name}</span>
                  {switching === membership.organization_id ? (
                    <span className="ml-2 text-xs text-foreground-secondary">{t('organizationStep.switching')}</span>
                  ) : null}
                </Button>
              </li>
            ))}
          </ul>

          {organizationError === null ? null : (
            <div
              role="alert"
              className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-[12.5px] text-error"
            >
              {organizationError}
            </div>
          )}

          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={switching !== null}
            onClick={() => {
              setAuthStep('credentials');
            }}
          >
            {t('organizationStep.back')}
          </Button>
        </section>
      </div>
    </div>
  );
}
