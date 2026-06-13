'use client';

import type { JSX } from 'react';

import { useLocale, useTranslations } from 'next-intl';

import { Eyebrow } from '@bimstitch/ui';

import type { Locale } from '@bimstitch/i18n';

import type { Project } from '@/lib/api/schemas';

import {
  formatAddress,
  formatDeliveryDate,
} from '@/lib/formatting/projects';
import { formatDate } from '@/lib/formatting/dates';

type Props = {
  project: Project;
};

function Row({ label, value }: { label: string; value: string | null }): JSX.Element | null {
  if (value === null || value.length === 0) return null;
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-foreground-tertiary">{label}</dt>
      <dd className="text-right text-foreground-secondary">{value}</dd>
    </div>
  );
}

export function ProjectAboutCard({ project }: Props): JSX.Element {
  const locale = useLocale() as Locale;
  const t = useTranslations('projects.about');
  const tStatuses = useTranslations('projects.statuses');
  const tPhases = useTranslations('projects.phases');
  const description = project.description === null || project.description.trim().length === 0
    ? null
    : project.description;

  const address = formatAddress(project);
  const deliveryDate = project.delivery_date !== null
    ? formatDeliveryDate(project.delivery_date, locale)
    : null;

  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <section className="flex flex-col gap-1.5">
        <Eyebrow as="div" tone="tertiary">{t('descriptionHeading')}</Eyebrow>
        {description === null ? (
          <p className="text-body3 italic text-foreground-tertiary">
            {t('noDescription')}
          </p>
        ) : (
          <p className="whitespace-pre-line text-body2 text-foreground-secondary">
            {description}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <Eyebrow as="div" tone="tertiary">{t('infoHeading')}</Eyebrow>
        <dl className="flex flex-col gap-1 text-body3">
          <Row label={t('referenceCode')} value={project.reference_code} />
          <Row label={t('status')} value={tStatuses(project.status)} />
          <Row label={t('phase')} value={tPhases(project.phase)} />
          <Row label={t('delivery')} value={deliveryDate} />
          <Row label={t('permit')} value={project.permit_number} />
          <Row label={t('contractor')} value={project.contractor_name} />
        </dl>
      </section>

      {(address !== null || project.municipality !== null) && (
        <section className="flex flex-col gap-2 border-t border-border pt-4">
          <Eyebrow as="div" tone="tertiary">{t('addressHeading')}</Eyebrow>
          <dl className="flex flex-col gap-1 text-body3">
            <Row label={t('address')} value={address} />
            <Row label={t('municipality')} value={project.municipality} />
            <Row label={t('bagId')} value={project.bag_id} />
          </dl>
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <Eyebrow as="div" tone="tertiary">{t('timestampsHeading')}</Eyebrow>
        <dl className="flex flex-col gap-1 text-body3">
          <Row label={t('created')} value={formatDate(project.created_at, locale)} />
          <Row label={t('updated')} value={formatDate(project.updated_at, locale)} />
        </dl>
      </section>
    </aside>
  );
}
