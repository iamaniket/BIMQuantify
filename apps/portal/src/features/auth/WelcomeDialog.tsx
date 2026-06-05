'use client';

import { CheckCircle2, ArrowRight } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@bimstitch/ui';

import { useRouter } from '@/i18n/navigation';

interface WelcomeDialogProps {
  open: boolean;
  organizationName: string;
  isAdmin: boolean;
  onClose: () => void;
}

export function WelcomeDialog({
  open,
  organizationName,
  isAdmin,
  onClose,
}: WelcomeDialogProps): JSX.Element {
  const t = useTranslations('onboarding');
  const router = useRouter();

  const capabilities: string[] = isAdmin
    ? [t('capabilities.admin.manageTeam'), t('capabilities.admin.createProjects'), t('capabilities.admin.fullAccess')]
    : [t('capabilities.member.viewProjects'), t('capabilities.member.uploadDocuments'), t('capabilities.member.trackFindings')];

  const handleGetStarted = (): void => {
    onClose();
    router.push('/projects');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('title', { org: organizationName })}</DialogTitle>
          <p className="text-body3 text-foreground-secondary mt-1">
            {isAdmin ? t('roleDescriptionAdmin') : t('roleDescriptionMember')}
          </p>
        </DialogHeader>
        <DialogBody>
          <ul className="flex flex-col gap-2">
            {capabilities.map((cap) => (
              <li key={cap} className="flex items-start gap-2 text-body3 text-foreground-secondary">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
                <span>{cap}</span>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" size="md" onClick={handleGetStarted} className="flex items-center gap-1.5">
            {t('getStarted')}
            <ArrowRight size={18} aria-hidden />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
