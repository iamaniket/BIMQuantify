'use client';

import { Check } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { AppDialog } from '@bimdossier/ui';

import { useRouter } from '@/i18n/navigation';

const ADMIN_CAPABILITIES = [
  'capAdminManageTeam',
  'capAdminCreateProjects',
  'capAdminFullAccess',
] as const;

const MEMBER_CAPABILITIES = [
  'capMemberViewProjects',
  'capMemberUploadDocs',
  'capMemberTrackFindings',
] as const;

type Props = {
  open: boolean;
  orgName: string;
  isAdmin: boolean;
  onClose: () => void;
};

/**
 * Post-accept onboarding dialog (backlog #11). Shown once a user accepts an
 * organization invitation, it greets them by org name and lists the
 * capabilities their assigned role unlocks, then routes them into the app.
 */
export function WelcomeDialog({ open, orgName, isAdmin, onClose }: Props): JSX.Element {
  const t = useTranslations('onboarding.welcome');
  const router = useRouter();

  const capabilities = isAdmin ? ADMIN_CAPABILITIES : MEMBER_CAPABILITIES;

  const onGetStarted = (): void => {
    onClose();
    router.push('/projects');
  };

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      width={460}
      eyebrow={t('eyebrow')}
      title={t('title', { org: orgName })}
      subtitle={isAdmin ? t('subtitleAdmin') : t('subtitleMember')}
      onSave={onGetStarted}
      saveLabel={t('getStarted')}
      cancelLabel={t('dismiss')}
    >
      <ul className="flex flex-col gap-2.5">
        {capabilities.map((cap) => (
          <li key={cap} className="flex items-start gap-2.5">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success-light text-success">
              <Check className="h-3 w-3" aria-hidden />
            </span>
            <span className="text-body2 text-foreground">{t(cap)}</span>
          </li>
        ))}
      </ul>
    </AppDialog>
  );
}
