'use client';

import { AlertTriangle, Search } from '@bimdossier/ui/icons';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Input } from '@bimdossier/ui';

import { PageShell } from '@/components/shared/layout/PageShell';
import { useExpiringCertificates } from '@/features/certificates/useExpiringCertificates';
import { NewProjectButton } from '@/features/projects/NewProjectButton';
import { ProjectList } from '@/features/projects/ProjectList';
import { ProjectsHero } from '@/features/projects/ProjectsHero';
import { ProjectPhaseFilter, type PhaseFilter } from '@/features/projects/ProjectPhaseFilter';
import { useProjects } from '@/features/projects/useProjects';
import { useIsFreeUser } from '@/hooks/useIsFreeUser';

/**
 * The projects dashboard — shared by paid and free (org-less) users. Its data
 * hooks (`useProjects`, the per-project members fetch) are free-aware, so the UI
 * renders identically for both tiers; the only tier-specific bit is the
 * certificate-expiry warning, which is org-only and hidden for free users.
 */
export function PaidProjectsView(): JSX.Element {
  const t = useTranslations('projects.page');
  const { isFreeUser } = useIsFreeUser();
  const [search, setSearch] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];
  const certWarning = useExpiringCertificates(projects);

  return (
    <PageShell
      hero={<ProjectsHero projects={projects} certWarning={certWarning} />}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5">
        {!isFreeUser && certWarning.total > 0 && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-warning bg-warning/10 px-4 py-3 xl:hidden">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span className="text-body3 font-medium text-foreground">
              {t('expiryWarning', { count: certWarning.total })}
            </span>
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-auto sm:min-w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-tertiary" />
            <Input
              type="search"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); }}
              className="w-full pl-9"
              aria-label={t('searchAriaLabel')}
            />
          </div>
          <ProjectPhaseFilter
            projects={projects}
            value={phaseFilter}
            onChange={setPhaseFilter}
          />
          <div className="ml-auto">
            <NewProjectButton />
          </div>
        </div>

        <ProjectList search={search} phaseFilter={phaseFilter} />
      </div>
    </PageShell>
  );
}
