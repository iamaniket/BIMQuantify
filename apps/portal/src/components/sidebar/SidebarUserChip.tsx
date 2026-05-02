'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import type { JSX } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@bimstitch/ui';

import { useTranslations } from 'next-intl';

import { useAuth } from '@/providers/AuthProvider';

import { useSidebar } from './SidebarContext';

export function SidebarUserChip(): JSX.Element {
  const { collapsed } = useSidebar();
  const { setTokens } = useAuth();
  const t = useTranslations('sidebar');
  const router = useRouter();

  const onSignOut = (): void => {
    setTokens(null);
    router.replace('/login');
  };

  const actionButtonClassName =
    'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white';
  const actionIconClassName = 'h-[1.3rem] w-[1.3rem] text-white/55';

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-t border-white/12 px-2 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="grid h-8 w-8 cursor-default place-items-center rounded-full bg-primary-light text-caption font-extrabold text-primary"
              title={t('userSummary')}
            >
              LB
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">{t('userSummary')}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 border-t border-white/12 px-3 py-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-light text-caption font-extrabold text-primary">
        LB
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body3 font-semibold text-white">Lieke Beumer</div>
        <div className="truncate text-caption text-white/55">{t('userRole')}</div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onSignOut}
            className={actionButtonClassName}
          >
            <LogOut className={actionIconClassName} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{t('signOut')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
