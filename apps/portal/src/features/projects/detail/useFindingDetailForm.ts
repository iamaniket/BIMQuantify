'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import {
  useForm,
  type Path,
  type SubmitHandler,
  type UseFormRegisterReturn,
  type UseFormReturn,
} from 'react-hook-form';
import { z } from 'zod';

import { useDeleteFinding } from '@/features/findings/useDeleteFinding';
import { useUpdateFinding } from '@/features/findings/useUpdateFinding';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useRegisterField } from '@/hooks/useRegisterField';
import type {
  Finding,
  FindingStatusValue,
  FindingUpdateInput,
  ProjectMemberList,
} from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

export const FINDING_SEVERITIES = ['low', 'medium', 'high'] as const;

export const FindingDetailFormSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(4000),
  severity: z.enum(FINDING_SEVERITIES),
  bbl_article_ref: z.string().max(50).optional().or(z.literal('')),
  assignee_user_id: z.string().optional().or(z.literal('')),
  deadline_date: z.string().optional().or(z.literal('')),
});

export type FindingDetailFormValues = z.infer<typeof FindingDetailFormSchema>;

type PatchOptions = {
  status?: FindingStatusValue;
  resolutionNote?: string;
  resolutionEvidenceIds?: string[];
};

function buildPatch(
  values: FindingDetailFormValues,
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

/** `useRegisterField` returns a register bound to the whole field-name union. */
type FindingFieldRegister = UseFormRegisterReturn<Path<FindingDetailFormValues>>;

export type FindingDetailFormApi = {
  form: UseFormReturn<FindingDetailFormValues>;
  fields: {
    title: FindingFieldRegister;
    description: FindingFieldRegister;
    severity: FindingFieldRegister;
    bbl: FindingFieldRegister;
    assignee: FindingFieldRegister;
    deadline: FindingFieldRegister;
  };
  members: ProjectMemberList;
  membersLoading: boolean;
  photoIds: string[];
  setPhotoIds: (ids: string[]) => void;
  referenceAttachmentIds: string[];
  setReferenceAttachmentIds: (ids: string[]) => void;
  resolutionNote: string;
  setResolutionNote: (note: string) => void;
  resolutionEvidenceIds: string[];
  setResolutionEvidenceIds: (ids: string[]) => void;
  confirmDelete: boolean;
  setConfirmDelete: (value: boolean) => void;
  isPending: boolean;
  canPromote: boolean;
  canResolve: boolean;
  showResolve: boolean;
  isResolved: boolean;
  isInspector: boolean;
  isLinked: boolean;
  /** form.handleSubmit(onSubmit) — persists edits without changing status. */
  save: () => void;
  /** Promote a draft to `open` (requires assignee + deadline). */
  promote: () => void;
  /** Mark an open/in-progress finding `resolved` (requires note + evidence). */
  resolve: () => void;
  /** Inspector verifies a resolved finding. */
  verify: () => void;
  /** Delete the finding. */
  remove: () => void;
  /** Drop the element link (coordinate stays). */
  unlink: () => void;
};

/**
 * Shared controller for the finding editor — owns the form, photo/reference and
 * resolution state, and all the status-transition handlers. Consumed by both
 * `FindingDetailModal` (dialog chrome for project tabs/kanban/calendar) and
 * `FindingDetailForm` (in-panel viewer surface). `finding` may be `null` so the
 * modal can call the hook unconditionally and early-return on a closed dialog.
 */
export function useFindingDetailForm(
  projectId: string,
  finding: Finding | null,
  opts: { onSaved?: (() => void) | undefined; onDeleted?: (() => void) | undefined } = {},
): FindingDetailFormApi {
  const { onSaved, onDeleted } = opts;
  const { me } = useAuth();
  const membersQuery = useProjectMembers(projectId);
  const updateMutation = useUpdateFinding(projectId);
  const deleteMutation = useDeleteFinding(projectId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [referenceAttachmentIds, setReferenceAttachmentIds] = useState<string[]>([]);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolutionEvidenceIds, setResolutionEvidenceIds] = useState<string[]>([]);

  const form = useForm<FindingDetailFormValues>({ resolver: zodResolver(FindingDetailFormSchema) });
  const { reset: resetForm } = form;

  const fields = {
    title: useRegisterField(form, 'title'),
    description: useRegisterField(form, 'description'),
    severity: useRegisterField(form, 'severity'),
    bbl: useRegisterField(form, 'bbl_article_ref'),
    assignee: useRegisterField(form, 'assignee_user_id'),
    deadline: useRegisterField(form, 'deadline_date'),
  };

  // Reset whenever a *different* finding is shown (a new row expands) or this
  // finding is refetched after a server change. Keyed on id + updated_at — not
  // the object identity — so unrelated list refetches don't clobber in-progress
  // edits (and a caller passing a fresh object each render can't loop us).
  useEffect(() => {
    if (finding === null) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finding?.id, finding?.updated_at, resetForm]);

  const members = membersQuery.data ?? [];
  const assigneeValue = form.watch('assignee_user_id');
  const deadlineValue = form.watch('deadline_date');
  const hasAssignee = assigneeValue !== undefined && assigneeValue !== '';
  const hasDeadline = deadlineValue !== undefined && deadlineValue !== '';
  const isPending = updateMutation.isPending || deleteMutation.isPending;

  const currentUserId = me === null ? null : me.user.id;
  const isInspector = members.some(
    (m) => m.user_id === currentUserId && m.role === 'inspector',
  );
  const status = finding?.status ?? null;
  const canPromote = status === 'draft' && hasAssignee && hasDeadline;
  const canResolve =
    (status === 'open' || status === 'in_progress') &&
    resolutionNote.trim() !== '' &&
    resolutionEvidenceIds.length > 0;
  const isResolved = status === 'resolved' || status === 'verified';
  const showResolve = status === 'open' || status === 'in_progress';
  const isLinked = finding?.linked_element_global_id != null;

  const mutateWithSaved = (input: FindingUpdateInput): void => {
    if (finding === null) return;
    updateMutation.mutate(
      { findingId: finding.id, input },
      { onSuccess: () => { onSaved?.(); } },
    );
  };

  const onSubmit: SubmitHandler<FindingDetailFormValues> = (values) => {
    mutateWithSaved(buildPatch(values, photoIds, referenceAttachmentIds));
  };
  const onPromoteSubmit: SubmitHandler<FindingDetailFormValues> = (values) => {
    mutateWithSaved(buildPatch(values, photoIds, referenceAttachmentIds, { status: 'open' }));
  };
  const onResolveSubmit: SubmitHandler<FindingDetailFormValues> = (values) => {
    mutateWithSaved(
      buildPatch(values, photoIds, referenceAttachmentIds, {
        status: 'resolved',
        resolutionNote: resolutionNote.trim(),
        resolutionEvidenceIds,
      }),
    );
  };

  return {
    form,
    fields,
    members,
    membersLoading: membersQuery.isLoading,
    photoIds,
    setPhotoIds,
    referenceAttachmentIds,
    setReferenceAttachmentIds,
    resolutionNote,
    setResolutionNote,
    resolutionEvidenceIds,
    setResolutionEvidenceIds,
    confirmDelete,
    setConfirmDelete,
    isPending,
    canPromote,
    canResolve,
    showResolve,
    isResolved,
    isInspector,
    isLinked,
    save: form.handleSubmit(onSubmit),
    promote: form.handleSubmit(onPromoteSubmit),
    resolve: form.handleSubmit(onResolveSubmit),
    verify: () => { mutateWithSaved({ status: 'verified' }); },
    remove: () => {
      if (finding === null) return;
      deleteMutation.mutate(finding.id, { onSuccess: () => { onDeleted?.(); } });
    },
    unlink: () => {
      mutateWithSaved({
        linked_model_id: null,
        linked_file_id: null,
        linked_element_global_id: null,
      });
    },
  };
}
