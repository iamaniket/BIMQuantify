'use client';

import {
  ArrowRight, FileText, Info, Users,
} from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Link } from '@/i18n/navigation';
import type { FindingSeverityValue, FindingStatusValue } from '@/lib/api/schemas';

// Mirrors VALID_TRANSITIONS in features/findings/board/kanbanTransitions.ts —
// kept here as static display data for the read-only workflow legend.
const WORKFLOW: { status: FindingStatusValue; next: FindingStatusValue[] }[] = [
  { status: 'draft', next: ['open'] },
  { status: 'open', next: ['in_progress', 'resolved'] },
  { status: 'in_progress', next: ['open', 'resolved'] },
  { status: 'resolved', next: ['in_progress', 'verified'] },
  { status: 'verified', next: [] },
];

const STATUS_COLORS: Record<FindingStatusValue, string> = {
  draft: 'var(--foreground-tertiary)',
  open: 'var(--info)',
  in_progress: 'var(--primary)',
  resolved: 'var(--success)',
  verified: 'var(--success)',
};

const SEVERITIES: { severity: FindingSeverityValue; color: string }[] = [
  { severity: 'high', color: 'var(--error)' },
  { severity: 'medium', color: 'var(--warning)' },
  { severity: 'low', color: 'var(--foreground-tertiary)' },
];

type SectionProps = {
  icon: JSX.Element;
  title: string;
  children: JSX.Element;
};

function Section({ icon, title, children }: SectionProps): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surface-main p-4">
      <div className="mb-3 flex items-center gap-2 text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function Dot({ color }: { color: string }): JSX.Element {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

type Props = {
  projectId: string;
};

export function FindingsSettingsTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.settings');
  const tStatus = useTranslations('findingsBoard.columns');
  const tSeverity = useTranslations('findings.severity');

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section icon={<Info className="h-3.5 w-3.5" aria-hidden />} title={t('workflowTitle')}>
        <div className="flex flex-col gap-3">
          <p className="text-body3 text-foreground-secondary">{t('workflowIntro')}</p>
          <ul className="flex flex-col gap-2">
            {WORKFLOW.map(({ status, next }) => (
              <li key={status} className="flex items-center gap-2 text-body3">
                <Dot color={STATUS_COLORS[status]} />
                <span className="font-semibold text-foreground">{tStatus(status)}</span>
                {next.length > 0 ? (
                  <>
                    <ArrowRight className="h-3 w-3 text-foreground-tertiary" aria-hidden />
                    <span className="text-foreground-tertiary">{next.map((n) => tStatus(n)).join(', ')}</span>
                  </>
                ) : (
                  <span className="text-foreground-tertiary">· {t('terminal')}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-relaxed text-foreground-tertiary">{t('inspectorNote')}</p>
          <p className="text-[11px] leading-relaxed text-foreground-tertiary">{t('confirmNote')}</p>
        </div>
      </Section>

      <Section icon={<Info className="h-3.5 w-3.5" aria-hidden />} title={t('severityTitle')}>
        <ul className="flex flex-col gap-2">
          {SEVERITIES.map(({ severity, color }) => (
            <li key={severity} className="flex items-center gap-2 text-body3">
              <Dot color={color} />
              <span className="font-semibold text-foreground">{tSeverity(severity)}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden />} title={t('linksTitle')}>
        <div className="flex flex-col gap-2">
          <Link
            href="/templates"
            className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-body3 text-foreground-secondary transition-colors hover:bg-background-hover hover:text-foreground"
          >
            <FileText className="h-4 w-4 shrink-0 text-foreground-tertiary" aria-hidden />
            <span className="flex-1">{t('templatesLink')}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </Link>
          <Link
            href={`/projects/${projectId}`}
            className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-body3 text-foreground-secondary transition-colors hover:bg-background-hover hover:text-foreground"
          >
            <Users className="h-4 w-4 shrink-0 text-foreground-tertiary" aria-hidden />
            <span className="flex-1">{t('membersLink')}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </Link>
        </div>
      </Section>
    </div>
  );
}
