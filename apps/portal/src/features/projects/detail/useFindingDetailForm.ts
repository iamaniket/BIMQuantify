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
import { useFindingPinPreviewStore } from '@/features/viewer/shared/findingPinPreviewStore';
import { useProjectPermissions } from '@/features/permissions';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useRegisterField } from '@/hooks/useRegisterField';
import type {
  Finding,
  FindingStatusValue,
  FindingUpdateInput,
  LinkedFileTypeValue,
  ProjectMemberList,
} from '@/lib/api/schemas';

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

/** Local anchor state tracked by the form (saved on Submit, not immediately). */
export type LocalAnchor = {
  linked_file_type: LinkedFileTypeValue;
  anchor_x?: number | null | undefined;
  anchor_y?: number | null | undefined;
  anchor_z?: number | null | undefined;
  anchor_page?: number | null | undefined;
  linked_model_id?: string | null | undefined;
  linked_file_id?: string | null | undefined;
  linked_element_global_id?: string | null | undefined;
} | null;

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
  /** May edit finding fields / promote / resolve (Resource.finding update). */
  canEdit: boolean;
  /** May delete the finding (Resource.finding delete). */
  canDelete: boolean;
  isLinked: boolean;
  isPinned: boolean;
  /** The finding's current file type anchor, if any. */
  anchorFileType: LinkedFileTypeValue | null;
  /** Current local anchor (may differ from saved — committed on Save). */
  localAnchor: LocalAnchor;
  /** Stage a new/updated anchor locally (committed on Save, not immediately). */
  updateAnchor: (anchor: {
    linked_file_type: LinkedFileTypeValue;
    anchor_x?: number | null | undefined;
    anchor_y?: number | null | undefined;
    anchor_z?: number | null | undefined;
    anchor_page?: number | null | undefined;
    linked_model_id?: string | null | undefined;
    linked_file_id?: string | null | undefined;
    linked_element_global_id?: string | null | undefined;
  }) => void;
  /** Stage anchor removal locally (committed on Save, not immediately). */
  removeAnchor: () => void;
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
  const { can, canVerifyFinding } = useProjectPermissions(projectId);
  const membersQuery = useProjectMembers(projectId);
  const updateMutation = useUpdateFinding(projectId);
  const deleteMutation = useDeleteFinding(projectId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [referenceAttachmentIds, setReferenceAttachmentIds] = useState<string[]>([]);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolutionEvidenceIds, setResolutionEvidenceIds] = useState<string[]>([]);
  // `undefined` = no local change (use finding's saved anchor); `null` = user
  // removed the anchor; `{...}` = user placed/updated the anchor. Committed to
  // the server only when the form is saved, so the panel stays open.
  const [pendingAnchor, setPendingAnchor] = useState<LocalAnchor | undefined>(undefined);
  const setPinPreview = useFindingPinPreviewStore((s) => s.setPreview);
  const clearPinPreview = useFindingPinPreviewStore((s) => s.clear);

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
    setPendingAnchor(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finding?.id, finding?.updated_at, resetForm]);

  // Mirror the staged anchor into the viewer's draft-marker store so a re-picked
  // pin shows immediately (before Save). `undefined` = no local change → clear;
  // `null` = staged removal; otherwise the staged ifc/pdf anchor.
  useEffect(() => {
    if (finding === null) return;
    const fid = finding.id;
    if (pendingAnchor === undefined) {
      clearPinPreview(fid);
      return;
    }
    if (pendingAnchor === null) {
      setPinPreview({ findingId: fid, anchor: null, label: finding.title, status: finding.status });
      return;
    }
    const a = pendingAnchor;
    if (a.linked_file_type === 'ifc' && a.anchor_x != null && a.anchor_y != null && a.anchor_z != null) {
      setPinPreview({
        findingId: fid,
        anchor: { kind: 'ifc', x: a.anchor_x, y: a.anchor_y, z: a.anchor_z },
        label: finding.title,
        status: finding.status,
      });
    } else if (a.linked_file_type === 'pdf' && a.anchor_x != null && a.anchor_y != null && a.anchor_page != null) {
      setPinPreview({
        findingId: fid,
        anchor: { kind: 'pdf', x: a.anchor_x, y: a.anchor_y, page: a.anchor_page },
        label: finding.title,
        status: finding.status,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finding?.id, finding?.title, finding?.status, pendingAnchor, setPinPreview, clearPinPreview]);

  // Drop the draft preview when this finding collapses or a different one opens
  // (the id-guarded clear leaves a newly-mounted finding's preview intact).
  useEffect(() => {
    const fid = finding?.id;
    return () => {
      if (fid !== undefined) clearPinPreview(fid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finding?.id]);

  const members = membersQuery.data ?? [];
  const assigneeValue = form.watch('assignee_user_id');
  const deadlineValue = form.watch('deadline_date');
  const hasAssignee = assigneeValue !== undefined && assigneeValue !== '';
  const hasDeadline = deadlineValue !== undefined && deadlineValue !== '';
  const isPending = updateMutation.isPending || deleteMutation.isPending;

  const isInspector = canVerifyFinding;
  const canEdit = can('finding', 'update');
  const canDelete = can('finding', 'delete');
  const status = finding?.status ?? null;
  const canPromote = status === 'draft' && hasAssignee && hasDeadline;
  const canResolve =
    (status === 'open' || status === 'in_progress') &&
    resolutionNote.trim() !== '' &&
    resolutionEvidenceIds.length > 0;
  const isResolved = status === 'resolved' || status === 'verified';
  const showResolve = status === 'open' || status === 'in_progress';
  const isLinked = finding?.linked_element_global_id != null;
  // When pendingAnchor is `undefined` there's no local change — read from the
  // saved finding. When it's `null` the user staged a removal. Otherwise it
  // holds the locally-placed anchor that will be committed on Save.
  const effectiveAnchor: LocalAnchor | undefined =
    pendingAnchor !== undefined ? pendingAnchor : (
      finding?.anchor_x != null && finding.linked_file_type != null
        ? {
            linked_file_type: finding.linked_file_type,
            anchor_x: finding.anchor_x,
            anchor_y: finding.anchor_y,
            anchor_z: finding.anchor_z,
            anchor_page: finding.anchor_page,
            linked_element_global_id: finding.linked_element_global_id,
          }
        : null
    );
  const isPinned = effectiveAnchor != null && effectiveAnchor.anchor_x != null;
  const anchorFileType = effectiveAnchor?.linked_file_type ?? finding?.linked_file_type ?? null;

  const mutateWithSaved = (input: FindingUpdateInput): void => {
    if (finding === null) return;
    const id = finding.id;
    updateMutation.mutate(
      { findingId: id, input },
      // Drop the draft preview on success; the refetched finding carries the new
      // anchor, so the persisted marker takes over (merge de-dupes by id).
      { onSuccess: () => { clearPinPreview(id); onSaved?.(); } },
    );
  };

  const applyPendingAnchor = (patch: FindingUpdateInput): FindingUpdateInput => {
    if (pendingAnchor === undefined) return patch;
    if (pendingAnchor === null) {
      return {
        ...patch,
        linked_file_type: null,
        anchor_x: null,
        anchor_y: null,
        anchor_z: null,
        anchor_page: null,
        linked_model_id: null,
        linked_file_id: null,
        linked_element_global_id: null,
      };
    }
    const next: FindingUpdateInput = {
      ...patch,
      linked_file_type: pendingAnchor.linked_file_type,
      anchor_x: pendingAnchor.anchor_x ?? null,
      anchor_y: pendingAnchor.anchor_y ?? null,
      anchor_z: pendingAnchor.anchor_z ?? null,
      anchor_page: pendingAnchor.anchor_page ?? null,
      linked_element_global_id: pendingAnchor.linked_element_global_id ?? null,
    };
    // Only stamp model/file links when the pin actually carried them, so
    // re-pinning an already-linked finding never nulls its existing link.
    if (pendingAnchor.linked_model_id !== undefined) {
      next.linked_model_id = pendingAnchor.linked_model_id;
    }
    if (pendingAnchor.linked_file_id !== undefined) {
      next.linked_file_id = pendingAnchor.linked_file_id;
    }
    return next;
  };

  const onSubmit: SubmitHandler<FindingDetailFormValues> = (values) => {
    mutateWithSaved(applyPendingAnchor(buildPatch(values, photoIds, referenceAttachmentIds)));
  };
  const onPromoteSubmit: SubmitHandler<FindingDetailFormValues> = (values) => {
    mutateWithSaved(applyPendingAnchor(buildPatch(values, photoIds, referenceAttachmentIds, { status: 'open' })));
  };
  const onResolveSubmit: SubmitHandler<FindingDetailFormValues> = (values) => {
    mutateWithSaved(
      applyPendingAnchor(buildPatch(values, photoIds, referenceAttachmentIds, {
        status: 'resolved',
        resolutionNote: resolutionNote.trim(),
        resolutionEvidenceIds,
      })),
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
    canEdit,
    canDelete,
    isLinked,
    isPinned,
    anchorFileType,
    localAnchor: effectiveAnchor ?? null,
    updateAnchor: (anchor) => { setPendingAnchor(anchor); },
    removeAnchor: () => { setPendingAnchor(null); },
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
