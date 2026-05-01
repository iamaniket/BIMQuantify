'use client';

import type { JSX } from 'react';

import type { Project } from '@/lib/api/schemas';

import {
  formatAddress,
  formatDeliveryDate,
  formatPhase,
  formatStatus,
} from './projectFormatting';

type Props = {
  project: Project;
};

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(parsed);
}

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
  const description = project.description === null || project.description.trim().length === 0
    ? null
    : project.description;

  const address = formatAddress(project);
  const deliveryDate = project.delivery_date !== null
    ? formatDeliveryDate(project.delivery_date)
    : null;

  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <section className="flex flex-col gap-1.5">
        <h2 className="text-caption font-medium uppercase tracking-wide text-foreground-tertiary">
          Description
        </h2>
        {description === null ? (
          <p className="text-body3 italic text-foreground-tertiary">
            No description.
          </p>
        ) : (
          <p className="whitespace-pre-line text-body2 text-foreground-secondary">
            {description}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h2 className="text-caption font-medium uppercase tracking-wide text-foreground-tertiary">
          Project info
        </h2>
        <dl className="flex flex-col gap-1 text-body3">
          <Row label="Reference code" value={project.reference_code} />
          <Row label="Status" value={formatStatus(project.status)} />
          <Row label="Phase" value={formatPhase(project.phase)} />
          <Row label="Delivery" value={deliveryDate} />
          <Row label="Permit" value={project.permit_number} />
          <Row label="Contractor" value={project.contractor_name} />
        </dl>
      </section>

      {(address !== null || project.municipality !== null) && (
        <section className="flex flex-col gap-2 border-t border-border pt-4">
          <h2 className="text-caption font-medium uppercase tracking-wide text-foreground-tertiary">
            Site address
          </h2>
          <dl className="flex flex-col gap-1 text-body3">
            <Row label="Address" value={address} />
            <Row label="Municipality" value={project.municipality} />
            <Row label="BAG ID" value={project.bag_id} />
          </dl>
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h2 className="text-caption font-medium uppercase tracking-wide text-foreground-tertiary">
          Timestamps
        </h2>
        <dl className="flex flex-col gap-1 text-body3">
          <Row label="Created" value={formatDate(project.created_at)} />
          <Row label="Updated" value={formatDate(project.updated_at)} />
        </dl>
      </section>
    </aside>
  );
}
