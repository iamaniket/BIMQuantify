'use client';

import { Unlink } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useId, type JSX } from 'react';

import { Button, FormField, Input, Select, Textarea } from '@bimdossier/ui';

import type { DocumentViewerHandle, ViewerHandle } from '@bimdossier/viewer';

import { allowedMoveTargets } from '@/features/findings/board/kanbanTransitions';
import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import type { ViewMode } from '@/components/shared/viewer/shared/ViewModeSwitcher';
import { Field } from '@/components/shared/forms/Field';
import type { Finding, FindingStatusValue, LinkedFileTypeValue } from '@/lib/api/schemas';

import { FindingPinButton, type AnchorState, type ConvertFloorPlanPoint } from './FindingPinButton';
import { FindingPhotos } from './FindingPhotos';
import { ReferenceDocumentPicker } from './ReferenceDocumentPicker';
import { FINDING_SEVERITIES, type FindingDetailFormApi } from './useFindingDetailForm';

type Props = {
  projectId: string;
  finding: Finding;
  api: FindingDetailFormApi;
  /**
   * Opt-in two-column layout for the wide finding dialog. Narrow consumers
   * (the board/calendar rail, the inspector row) omit it and keep the single
   * stacked grid.
   */
  wide?: boolean;
  documentHandle?: DocumentViewerHandle | null | undefined;
  viewerHandle?: ViewerHandle | null | undefined;
  activeFileType?: LinkedFileTypeValue | null | undefined;
  /** Active model/file to attach when pinning a previously-unlinked finding. */
  activeModelId?: string | null | undefined;
  activeFileId?: string | null | undefined;
  /** Resolve the picked element's GlobalId (active model only), else null. */
  resolvePickedGlobalId?: ((item: { modelId: string; localId: number } | null) => string | null) | undefined;
  /** Current viewport layout — routes IFC picks to the floor-plan in 2D mode. */
  viewMode?: ViewMode | undefined;
  /** Active 2D pick surface (generated floor plan OR aligned PDF) for picking in 2D mode. */
  floorPlanHandle?: DocumentViewerHandle | null | undefined;
  /** Convert a normalized plan point to a 3D world anchor. */
  convertFloorPlanPoint?: ConvertFloorPlanPoint | undefined;
};

/**
 * The editable finding form body — every field plus the linked-element, promote,
 * resolve and verify sections. Pure presentation over {@link FindingDetailFormApi};
 * Save/Delete chrome is owned by the host (dialog footer or in-panel action row).
 */
export function FindingDetailFields({
  projectId,
  finding,
  api,
  wide = false,
  documentHandle,
  viewerHandle,
  activeFileType,
  activeModelId,
  activeFileId,
  resolvePickedGlobalId,
  viewMode,
  floorPlanHandle,
  convertFloorPlanPoint,
}: Props): JSX.Element {
  const t = useTranslations('findings.detail');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findingsBoard.columns');
  // Photos + references are paid attachments; free snags can't hold them, so
  // hide both blocks in free context (and avoid the paid attachments 409).
  const { isFreeUser } = useIsFreeUser();
  const { form, fields, isPending, canEdit } = api;
  const fieldsDisabled = isPending || !canEdit;
  const statusFieldId = useId();
  const moveTargets = allowedMoveTargets(finding.status, canEdit, api.isInspector);

  const pinFileType = activeFileType ?? api.anchorFileType;
  const la = api.localAnchor;
  const currentPinAnchor: AnchorState | null = la != null
    ? {
        linked_file_type: la.linked_file_type,
        anchor_x: la.anchor_x,
        anchor_y: la.anchor_y,
        anchor_z: la.anchor_z,
        anchor_page: la.anchor_page,
        linkedElementGlobalId: la.linked_element_global_id,
      }
    : null;

  const handlePinChange = useCallback(
    (anchor: AnchorState | null) => {
      if (anchor == null) {
        api.removeAnchor();
      } else if (anchor.linked_file_type != null) {
        api.updateAnchor({
          linked_file_type: anchor.linked_file_type,
          anchor_x: anchor.anchor_x,
          anchor_y: anchor.anchor_y,
          anchor_z: anchor.anchor_z,
          anchor_page: anchor.anchor_page,
          linked_document_id: anchor.linked_document_id,
          linked_file_id: anchor.linked_file_id,
          linked_element_global_id: anchor.linkedElementGlobalId,
        });
      }
    },
    [api],
  );

  // Each control is defined once and arranged differently per layout. `col-span-2`
  // is kept verbatim where it exists today (it is a no-op outside a CSS grid, so it
  // is harmless in the wide flex layout) — this keeps the stacked branch byte-identical.
  const titleField = (
    <Field form={form} name="title" label={t('fields.title')} className="col-span-2">
      {({ id }) => <Input id={id} {...fields.title} disabled={fieldsDisabled} />}
    </Field>
  );
  const descriptionField = (
    <Field form={form} name="description" label={t('fields.description')} className="col-span-2">
      {({ id }) => <Textarea id={id} rows={3} {...fields.description} disabled={fieldsDisabled} />}
    </Field>
  );
  const severityField = (
    <Field form={form} name="severity" label={t('fields.severity')}>
      {({ id }) => (
        <Select id={id} {...fields.severity} disabled={fieldsDisabled}>
          {FINDING_SEVERITIES.map((s) => (
            <option key={s} value={s}>{tSeverity(s)}</option>
          ))}
        </Select>
      )}
    </Field>
  );
  const bblField = (
    <Field form={form} name="bbl_article_ref" label={t('fields.bblArticleRef')}>
      {({ id }) => <Input id={id} {...fields.bbl} disabled={fieldsDisabled} />}
    </Field>
  );
  const assigneeField = (
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
  );
  const deadlineField = (
    <Field form={form} name="deadline_date" label={t('fields.deadline')}>
      {({ id }) => <Input id={id} type="date" {...fields.deadline} disabled={fieldsDisabled} />}
    </Field>
  );

  // Status mover — pick any legal next state to move the finding directly.
  // Gated moves (promote / resolve) reuse those handlers; the backend 422s
  // with a localized reason (→ toast) when their requirements aren't met.
  const statusField = (
    <FormField
      label={t('fields.status')}
      htmlFor={statusFieldId}
      labelClassName="text-label2 font-medium normal-case tracking-normal text-foreground"
      className="col-span-2"
    >
      <Select
        id={statusFieldId}
        value={finding.status}
        disabled={fieldsDisabled || moveTargets.length === 0}
        onChange={(e) => {
          const to = e.target.value as FindingStatusValue;
          if (to !== finding.status) api.changeStatus(to);
        }}
      >
        <option value={finding.status}>{tStatus(finding.status)}</option>
        {moveTargets.map((to) => (
          <option key={to} value={to}>{tStatus(to)}</option>
        ))}
      </Select>
    </FormField>
  );

  const photosBlock = (
    <FindingPhotos
      projectId={projectId}
      photoIds={api.photoIds}
      onChange={api.setPhotoIds}
      disabled={fieldsDisabled}
    />
  );

  const referencesBlock = (
    <ReferenceDocumentPicker
      projectId={projectId}
      referenceIds={api.referenceAttachmentIds}
      onChange={api.setReferenceAttachmentIds}
      disabled={fieldsDisabled || finding.status === 'verified'}
    />
  );

  const pinBlock = (
    <div className="col-span-2">
      <FindingPinButton
        fileType={pinFileType ?? null}
        currentAnchor={currentPinAnchor}
        onAnchorChange={handlePinChange}
        documentHandle={documentHandle}
        viewerHandle={viewerHandle}
        linkModelId={activeModelId}
        linkFileId={activeFileId}
        resolvePickedGlobalId={resolvePickedGlobalId}
        viewMode={viewMode}
        floorPlanHandle={floorPlanHandle}
        convertFloorPlanPoint={convertFloorPlanPoint}
        disabled={fieldsDisabled}
      />
    </div>
  );

  const linkedElementBox = api.isLinked && !api.isPinned ? (
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
  ) : null;

  const promoteBox = finding.status === 'draft' && canEdit ? (
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
  ) : null;

  const resolveBox = api.showResolve && canEdit ? (
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
  ) : null;

  const resolvedBox = api.isResolved ? (
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
  ) : null;

  // Narrow consumers (board/calendar rail, inspector row): single stacked grid —
  // reproduces today's exact markup so they don't regress.
  if (!wide) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {titleField}
        {descriptionField}
        {severityField}
        {bblField}
        {assigneeField}
        {deadlineField}
        {statusField}
        {!isFreeUser && <div className="col-span-2">{photosBlock}</div>}
        {!isFreeUser && <div className="col-span-2">{referencesBlock}</div>}
        {pinBlock}
        {linkedElementBox}
        {promoteBox}
        {resolveBox}
        {resolvedBox}
      </div>
    );
  }

  // Wide dialog: two independent columns (Title/Description left, workflow fields
  // right), Photos and Reference documents side by side, then full-width blocks.
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="flex flex-1 flex-col gap-4">
          {titleField}
          {descriptionField}
        </div>
        <div className="flex flex-1 flex-col gap-4">
          {assigneeField}
          {deadlineField}
          {statusField}
          {severityField}
          {bblField}
        </div>
      </div>
      {!isFreeUser && (
        <div className="flex items-start gap-4">
          <div className="flex-1">{photosBlock}</div>
          <div className="flex-1">{referencesBlock}</div>
        </div>
      )}
      {pinBlock}
      {linkedElementBox}
      {promoteBox}
      {resolveBox}
      {resolvedBox}
    </div>
  );
}
