'use client';

import { Unlink } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button, Input, Select, Textarea } from '@bimstitch/ui';

import { Field } from '@/components/shared/forms/Field';
import type { Finding } from '@/lib/api/schemas';

import { FindingPhotos } from './FindingPhotos';
import { ReferenceDocumentPicker } from './ReferenceDocumentPicker';
import { FINDING_SEVERITIES, type FindingDetailFormApi } from './useFindingDetailForm';

type Props = {
  projectId: string;
  finding: Finding;
  api: FindingDetailFormApi;
};

/**
 * The editable finding form body — every field plus the linked-element, promote,
 * resolve and verify sections. Pure presentation over {@link FindingDetailFormApi};
 * Save/Delete chrome is owned by the host (dialog footer or in-panel action row).
 */
export function FindingDetailFields({ projectId, finding, api }: Props): JSX.Element {
  const t = useTranslations('findings.detail');
  const tSeverity = useTranslations('findings.severity');
  const { form, fields, isPending, canEdit } = api;
  // No write permission (viewer/client) → form is a read-only view: inputs
  // disabled, write actions hidden. The API would 403 these anyway.
  const fieldsDisabled = isPending || !canEdit;

  return (
    <div className="grid grid-cols-2 gap-4">
      <Field form={form} name="title" label={t('fields.title')} className="col-span-2">
        {({ id }) => <Input id={id} {...fields.title} disabled={fieldsDisabled} />}
      </Field>
      <Field form={form} name="description" label={t('fields.description')} className="col-span-2">
        {({ id }) => <Textarea id={id} rows={3} {...fields.description} disabled={fieldsDisabled} />}
      </Field>
      <Field form={form} name="severity" label={t('fields.severity')}>
        {({ id }) => (
          <Select id={id} {...fields.severity} disabled={fieldsDisabled}>
            {FINDING_SEVERITIES.map((s) => (
              <option key={s} value={s}>{tSeverity(s)}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field form={form} name="bbl_article_ref" label={t('fields.bblArticleRef')}>
        {({ id }) => <Input id={id} {...fields.bbl} disabled={fieldsDisabled} />}
      </Field>
      <Field form={form} name="assignee_user_id" label={t('fields.assignee')}>
        {({ id }) => (
          <Select id={id} disabled={api.membersLoading || fieldsDisabled} {...fields.assignee}>
            <option value="">{t('placeholders.assignee')}</option>
            {api.members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name === null ? m.email : `${m.full_name} (${m.email})`}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field form={form} name="deadline_date" label={t('fields.deadline')}>
        {({ id }) => <Input id={id} type="date" {...fields.deadline} disabled={fieldsDisabled} />}
      </Field>

      <div className="col-span-2">
        <FindingPhotos
          projectId={projectId}
          photoIds={api.photoIds}
          onChange={api.setPhotoIds}
          disabled={fieldsDisabled}
        />
      </div>

      <div className="col-span-2">
        <ReferenceDocumentPicker
          projectId={projectId}
          referenceIds={api.referenceAttachmentIds}
          onChange={api.setReferenceAttachmentIds}
          disabled={fieldsDisabled || finding.status === 'verified'}
        />
      </div>

      {api.isLinked && (
        <div className="col-span-2 flex items-start justify-between gap-2 rounded-md border border-border bg-surface-low p-3">
          <div className="min-w-0">
            <div className="text-label2 font-medium text-foreground">
              {t('linkedElement.title')}
            </div>
            <p className="mt-1 text-caption text-foreground-tertiary">
              {t('linkedElement.description')}
            </p>
          </div>
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={isPending}
              onClick={api.unlink}
            >
              <Unlink className="mr-1.5 h-3.5 w-3.5" />
              {t('linkedElement.unlink')}
            </Button>
          )}
        </div>
      )}

      {finding.status === 'draft' && canEdit && (
        <div className="col-span-2 rounded-md border border-border bg-surface-low p-3">
          <div className="text-label2 font-medium text-foreground">
            {t('promote.title')}
          </div>
          <p className="mt-1 text-caption text-foreground-tertiary">
            {t('promote.hint')}
          </p>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="mt-2"
            disabled={!api.canPromote || isPending}
            onClick={api.promote}
          >
            {t('promote.action')}
          </Button>
        </div>
      )}

      {api.showResolve && canEdit && (
        <div className="col-span-2 flex flex-col gap-3 rounded-md border border-border bg-surface-low p-3">
          <div>
            <div className="text-label2 font-medium text-foreground">
              {t('resolution.title')}
            </div>
            <p className="mt-1 text-caption text-foreground-tertiary">
              {t('resolution.hint')}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-label2 font-medium text-foreground">
              {t('resolution.noteLabel')}
            </span>
            <Textarea
              rows={3}
              value={api.resolutionNote}
              placeholder={t('resolution.notePlaceholder')}
              disabled={isPending}
              onChange={(e) => { api.setResolutionNote(e.target.value); }}
            />
          </div>
          <FindingPhotos
            projectId={projectId}
            photoIds={api.resolutionEvidenceIds}
            onChange={api.setResolutionEvidenceIds}
            disabled={isPending}
            label={t('resolution.evidenceLabel')}
          />
          <Button
            type="button"
            variant="primary"
            size="md"
            className="self-start"
            disabled={!api.canResolve || isPending}
            onClick={api.resolve}
          >
            {t('resolution.action')}
          </Button>
        </div>
      )}

      {api.isResolved && (
        <div className="col-span-2 flex flex-col gap-3 rounded-md border border-border bg-surface-low p-3">
          <div>
            <div className="text-label2 font-medium text-foreground">
              {t('resolution.recordedTitle')}
            </div>
            {finding.resolution_note !== null && finding.resolution_note !== '' && (
              <p className="mt-1 whitespace-pre-wrap text-body3 text-foreground-secondary">
                {finding.resolution_note}
              </p>
            )}
          </div>
          {api.resolutionEvidenceIds.length > 0 && (
            <FindingPhotos
              projectId={projectId}
              photoIds={api.resolutionEvidenceIds}
              onChange={api.setResolutionEvidenceIds}
              disabled
              label={t('resolution.evidenceLabel')}
            />
          )}
          {finding.status === 'resolved' && api.isInspector && (
            <div className="border-t border-border pt-3">
              <div className="text-label2 font-medium text-foreground">
                {t('verify.title')}
              </div>
              <p className="mt-1 text-caption text-foreground-tertiary">
                {t('verify.hint')}
              </p>
              <Button
                type="button"
                variant="primary"
                size="md"
                className="mt-2"
                disabled={isPending}
                onClick={api.verify}
              >
                {t('verify.action')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
