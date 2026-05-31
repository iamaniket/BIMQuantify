'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2, Unlink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import {
  AppDialog,
  Badge,
  Button,
  Input,
  Select,
  Textarea,
} from '@bimstitch/ui';

import { Field } from '@/components/shared/forms/Field';
import { useDeleteFinding } from '@/features/findings/useDeleteFinding';
import { useUpdateFinding } from '@/features/findings/useUpdateFinding';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useRegisterField } from '@/hooks/useRegisterField';
import type { Finding, FindingStatusValue, FindingUpdateInput } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { FindingPhotos } from './FindingPhotos';
import { ReferenceDocumentPicker } from './ReferenceDocumentPicker';
import { statusBadgeVariant } from './findingBadges';

const SEVERITIES = ['low', 'medium', 'high'] as const;

const FormSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(4000),
  severity: z.enum(SEVERITIES),
  bbl_article_ref: z.string().max(50).optional().or(z.literal('')),
  assignee_user_id: z.string().optional().or(z.literal('')),
  deadline_date: z.string().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof FormSchema>;

type Props = {
  projectId: string;
  finding: Finding | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type PatchOptions = {
  status?: FindingStatusValue;
  resolutionNote?: string;
  resolutionEvidenceIds?: string[];
};

function buildPatch(
  values: FormValues,
  photoIds: string[],
  referenceAttachmentIds: string[],
  opts: PatchOptions = {},
): FindingUpdateInput {
  const patch: FindingUpdateInput = {
    title: values.title.trim(),
    description: values.description.trim(),
    severity: values.severity,
    bbl_article_ref:
      values.bbl_article_ref === undefined || values.bbl_article_ref === ''
        ? null
        : values.bbl_article_ref.trim(),
    assignee_user_id:
      values.assignee_user_id === undefined || values.assignee_user_id === ''
        ? null
        : values.assignee_user_id,
    deadline_date:
      values.deadline_date === undefined || values.deadline_date === ''
        ? null
        : values.deadline_date,
    photo_ids: photoIds,
    reference_attachment_ids: referenceAttachmentIds,
  };
  if (opts.status !== undefined) {
    patch.status = opts.status;
  }
  if (opts.resolutionNote !== undefined) {
    patch.resolution_note = opts.resolutionNote;
  }
  if (opts.resolutionEvidenceIds !== undefined) {
    patch.resolution_evidence_ids = opts.resolutionEvidenceIds;
  }
  return patch;
}

export function FindingDetailModal({
  projectId,
  finding,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('findings.detail');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findings.status');
  const { me } = useAuth();
  const membersQuery = useProjectMembers(projectId);
  const updateMutation = useUpdateFinding(projectId);
  const deleteMutation = useDeleteFinding(projectId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [referenceAttachmentIds, setReferenceAttachmentIds] = useState<string[]>([]);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolutionEvidenceIds, setResolutionEvidenceIds] = useState<string[]>([]);

  const form = useForm<FormValues>({ resolver: zodResolver(FormSchema) });
  const { reset: resetForm } = form;

  const titleField = useRegisterField(form, 'title');
  const descriptionField = useRegisterField(form, 'description');
  const severityField = useRegisterField(form, 'severity');
  const bblField = useRegisterField(form, 'bbl_article_ref');
  const assigneeField = useRegisterField(form, 'assignee_user_id');
  const deadlineField = useRegisterField(form, 'deadline_date');

  useEffect(() => {
    if (open && finding !== null) {
      resetForm({
        title: finding.title,
        description: finding.description,
        severity: finding.severity,
        bbl_article_ref: finding.bbl_article_ref ?? '',
        assignee_user_id: finding.assignee_user_id ?? '',
        deadline_date: finding.deadline_date ?? '',
      });
      setPhotoIds(finding.photo_ids ?? []);
      setReferenceAttachmentIds(finding.reference_attachment_ids ?? []);
      setResolutionNote(finding.resolution_note ?? '');
      setResolutionEvidenceIds(finding.resolution_evidence_ids ?? []);
      setConfirmDelete(false);
    }
  }, [open, finding, resetForm]);

  if (finding === null) {
    return <></>;
  }

  const members = membersQuery.data ?? [];
  const assigneeValue = form.watch('assignee_user_id');
  const deadlineValue = form.watch('deadline_date');
  const hasAssignee = assigneeValue !== undefined && assigneeValue !== '';
  const hasDeadline = deadlineValue !== undefined && deadlineValue !== '';
  const canPromote = finding.status === 'draft' && hasAssignee && hasDeadline;
  const isPending = updateMutation.isPending || deleteMutation.isPending;

  const currentUserId = me === null ? null : me.user.id;
  const isInspector = members.some(
    (m) => m.user_id === currentUserId && m.role === 'inspector',
  );
  const canResolve =
    (finding.status === 'open' || finding.status === 'in_progress') &&
    resolutionNote.trim() !== '' &&
    resolutionEvidenceIds.length > 0;
  const isResolved = finding.status === 'resolved' || finding.status === 'verified';
  const showResolve = finding.status === 'open' || finding.status === 'in_progress';

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    updateMutation.mutate(
      { findingId: finding.id, input: buildPatch(values, photoIds, referenceAttachmentIds) },
      { onSuccess: () => { onOpenChange(false); } },
    );
  };

  const onPromoteSubmit: SubmitHandler<FormValues> = (values) => {
    updateMutation.mutate(
      { findingId: finding.id, input: buildPatch(values, photoIds, referenceAttachmentIds, { status: 'open' }) },
      { onSuccess: () => { onOpenChange(false); } },
    );
  };

  const onResolveSubmit: SubmitHandler<FormValues> = (values) => {
    updateMutation.mutate(
      {
        findingId: finding.id,
        input: buildPatch(values, photoIds, referenceAttachmentIds, {
          status: 'resolved',
          resolutionNote: resolutionNote.trim(),
          resolutionEvidenceIds,
        }),
      },
      { onSuccess: () => { onOpenChange(false); } },
    );
  };

  const onVerify = (): void => {
    updateMutation.mutate(
      { findingId: finding.id, input: { status: 'verified' } },
      { onSuccess: () => { onOpenChange(false); } },
    );
  };

  const handleDelete = (): void => {
    deleteMutation.mutate(finding.id, {
      onSuccess: () => { onOpenChange(false); },
    });
  };

  const handleUnlink = (): void => {
    updateMutation.mutate({
      findingId: finding.id,
      input: { linked_model_id: null, linked_file_id: null, linked_element_global_id: null },
    });
  };

  const isLinked = finding.linked_element_global_id !== null;

  const deleteFooter = confirmDelete ? (
    <div className="flex items-center gap-2">
      <span className="text-body3 text-foreground-secondary">
        {t('delete.confirm')}
      </span>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={isPending}
        onClick={handleDelete}
      >
        {t('delete.confirmAction')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => { setConfirmDelete(false); }}
      >
        {t('delete.cancel')}
      </Button>
    </div>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => { setConfirmDelete(true); }}
    >
      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
      {t('delete.action')}
    </Button>
  );

  return (
    <AppDialog
      open={open}
      onClose={() => { onOpenChange(false); }}
      title={t('title')}
      subtitle={t('subtitle')}
      headerMeta={(
        <Badge variant={statusBadgeVariant(finding.status)}>
          {tStatus(finding.status)}
        </Badge>
      )}
      onSave={form.handleSubmit(onSubmit)}
      saveLabel={t('save')}
      saveDisabled={isPending}
      footerInfo={deleteFooter}
      width={680}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field form={form} name="title" label={t('fields.title')} className="col-span-2">
          {({ id }) => (
            <Input id={id} {...titleField} />
          )}
        </Field>
        <Field form={form} name="description" label={t('fields.description')} className="col-span-2">
          {({ id }) => (
            <Textarea id={id} rows={3} {...descriptionField} />
          )}
        </Field>
        <Field form={form} name="severity" label={t('fields.severity')}>
          {({ id }) => (
            <Select id={id} {...severityField}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{tSeverity(s)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field form={form} name="bbl_article_ref" label={t('fields.bblArticleRef')}>
          {({ id }) => (
            <Input id={id} {...bblField} />
          )}
        </Field>
        <Field form={form} name="assignee_user_id" label={t('fields.assignee')}>
          {({ id }) => (
            <Select id={id} disabled={membersQuery.isLoading} {...assigneeField}>
              <option value="">{t('placeholders.assignee')}</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name === null ? m.email : `${m.full_name} (${m.email})`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field form={form} name="deadline_date" label={t('fields.deadline')}>
          {({ id }) => (
            <Input id={id} type="date" {...deadlineField} />
          )}
        </Field>

        <div className="col-span-2">
          <FindingPhotos
            projectId={projectId}
            photoIds={photoIds}
            onChange={setPhotoIds}
            disabled={isPending}
          />
        </div>

        <div className="col-span-2">
          <ReferenceDocumentPicker
            projectId={projectId}
            referenceIds={referenceAttachmentIds}
            onChange={setReferenceAttachmentIds}
            disabled={isPending || finding.status === 'verified'}
          />
        </div>

        {isLinked && (
          <div className="col-span-2 flex items-start justify-between gap-2 rounded-md border border-border bg-surface-low p-3">
            <div className="min-w-0">
              <div className="text-label2 font-medium text-foreground">
                {t('linkedElement.title')}
              </div>
              <p className="mt-1 text-caption text-foreground-tertiary">
                {t('linkedElement.description')}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={handleUnlink}
            >
              <Unlink className="mr-1.5 h-3.5 w-3.5" />
              {t('linkedElement.unlink')}
            </Button>
          </div>
        )}

        {finding.status === 'draft' && (
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
              size="sm"
              className="mt-2"
              disabled={!canPromote || isPending}
              onClick={form.handleSubmit(onPromoteSubmit)}
            >
              {t('promote.action')}
            </Button>
          </div>
        )}

        {showResolve && (
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
                value={resolutionNote}
                placeholder={t('resolution.notePlaceholder')}
                disabled={isPending}
                onChange={(e) => { setResolutionNote(e.target.value); }}
              />
            </div>
            <FindingPhotos
              projectId={projectId}
              photoIds={resolutionEvidenceIds}
              onChange={setResolutionEvidenceIds}
              disabled={isPending}
              label={t('resolution.evidenceLabel')}
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="self-start"
              disabled={!canResolve || isPending}
              onClick={form.handleSubmit(onResolveSubmit)}
            >
              {t('resolution.action')}
            </Button>
          </div>
        )}

        {isResolved && (
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
            {resolutionEvidenceIds.length > 0 && (
              <FindingPhotos
                projectId={projectId}
                photoIds={resolutionEvidenceIds}
                onChange={setResolutionEvidenceIds}
                disabled
                label={t('resolution.evidenceLabel')}
              />
            )}
            {finding.status === 'resolved' && isInspector && (
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
                  size="sm"
                  className="mt-2"
                  disabled={isPending}
                  onClick={onVerify}
                >
                  {t('verify.action')}
                </Button>
              </div>
            )}
          </div>
        )}

      </div>
    </AppDialog>
  );
}
