'use client';

import { Check, Mail, X } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { Button } from '@bimstitch/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { AuthFormIntro } from '@/features/auth/AuthFormIntro';
import { WelcomeDialog } from '@/features/auth/WelcomeDialog';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/client';
import {
  acceptInvitation,
  declineInvitation,
  listMyInvitations,
} from '@/lib/api/invitations';
import { type InvitationRead } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; invitations: InvitationRead[] }
  | { kind: 'error'; message: string };

type WelcomeState = {
  open: boolean;
  organizationName: string;
  isAdmin: boolean;
};

export function InvitationsPanel(): JSX.Element {
  const t = useTranslations('invitations');
  const router = useRouter();
  const { tokens, hasHydrated, refreshMe } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<WelcomeState>({
    open: false,
    organizationName: '',
    isAdmin: false,
  });

  const accessToken = tokens?.access_token ?? null;

  const load = useCallback(async (): Promise<void> => {
    if (accessToken === null) return;
    setState({ kind: 'loading' });
    try {
      const invitations = await listMyInvitations(accessToken);
      setState({ kind: 'ready', invitations });
    } catch (err) {
      const message = err instanceof ApiError ? err.detail : t('errors.loadFailed');
      setState({ kind: 'error', message });
    }
  }, [accessToken, t]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (accessToken === null) {
      router.replace('/login');
      return;
    }
    void load();
  }, [hasHydrated, accessToken, router, load]);

  const onAccept = async (organizationId: string): Promise<void> => {
    if (accessToken === null) return;
    setActionError(null);
    setPendingOrgId(organizationId);
    try {
      const inv = state.kind === 'ready'
        ? state.invitations.find((i) => i.organization_id === organizationId)
        : undefined;
      await acceptInvitation(accessToken, organizationId);
      await refreshMe();
      await load();
      setWelcome({
        open: true,
        organizationName: inv?.organization_name ?? '',
        isAdmin: inv?.is_org_admin ?? false,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.detail : t('errors.acceptFailed');
      setActionError(message);
    } finally {
      setPendingOrgId(null);
    }
  };

  const onDecline = async (organizationId: string): Promise<void> => {
    if (accessToken === null) return;
    setActionError(null);
    setPendingOrgId(organizationId);
    try {
      await declineInvitation(accessToken, organizationId);
      await load();
      toast.success(t('declineSuccess'));
    } catch (err) {
      const message = err instanceof ApiError ? err.detail : t('errors.declineFailed');
      setActionError(message);
    } finally {
      setPendingOrgId(null);
    }
  };

  if (!hasHydrated || accessToken === null) {
    return <AuthFormIntro eyebrow={t('eyebrow')} heading={t('title')} />;
  }

  if (state.kind === 'loading') {
    return (
      <>
        <AuthFormIntro eyebrow={t('eyebrow')} heading={t('title')} subtitle={t('loading')} />
      </>
    );
  }

  if (state.kind === 'error') {
    return (
      <>
        <AuthFormIntro eyebrow={t('eyebrow')} heading={t('title')} />
        <ErrorBanner message={state.message} tone="soft" />
        <Button variant="border" size="md" onClick={() => void load()} className="mt-3">
          {t('retry')}
        </Button>
      </>
    );
  }

  const invitations = state.invitations;

  if (invitations.length === 0) {
    return (
      <>
        <AuthFormIntro
          eyebrow={t('eyebrow')}
          heading={t('emptyTitle')}
          subtitle={t('emptyBody')}
        />
        <p className="text-sm">
          <a href="/projects" className="font-semibold text-primary no-underline">
            {t('backToProjects')}
          </a>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthFormIntro eyebrow={t('eyebrow')} heading={t('title')} subtitle={t('subtitle')} />
      <ul className="flex w-full flex-col gap-3">
        {invitations.map((inv) => {
          const isPending = pendingOrgId === inv.organization_id;
          const expiresAt = new Date(inv.expires_at);
          const formattedExpiry = Number.isNaN(expiresAt.getTime())
            ? inv.expires_at
            : expiresAt.toLocaleDateString();
          return (
            <li
              key={inv.organization_id}
              className="rounded-lg border border-border bg-background px-4 py-3"
            >
              <div className="flex flex-col gap-1">
                <div className="font-display text-[15px] font-medium text-foreground">
                  {inv.organization_name}
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-foreground-tertiary">
                  <Mail size={18} aria-hidden />
                  {inv.invited_by_email !== null
                    ? t('invitedBy', { email: inv.invited_by_email })
                    : t('invitedByUnknown')}
                </div>
                <div className="text-[11.5px] text-foreground-tertiary">
                  {inv.is_org_admin ? t('roleAdmin') : t('roleMember')}
                  {' · '}
                  {t('expiresOn', { date: formattedExpiry })}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isPending}
                  onClick={() => void onAccept(inv.organization_id)}
                  className="flex items-center gap-1.5"
                >
                  <Check size={18} aria-hidden />
                  {isPending ? t('accepting') : t('accept')}
                </Button>
                <Button
                  variant="border"
                  size="sm"
                  disabled={isPending}
                  onClick={() => void onDecline(inv.organization_id)}
                  className="flex items-center gap-1.5"
                >
                  <X size={18} aria-hidden />
                  {isPending ? t('declining') : t('decline')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <ErrorBanner message={actionError} tone="soft" className="mt-3" />
      <WelcomeDialog
        open={welcome.open}
        organizationName={welcome.organizationName}
        isAdmin={welcome.isAdmin}
        onClose={() => setWelcome((w) => ({ ...w, open: false }))}
      />
    </>
  );
}
