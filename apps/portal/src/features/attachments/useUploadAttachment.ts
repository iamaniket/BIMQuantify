'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { uploadAttachmentEnd2End, type AttachmentUploadProgressEvent } from '@/lib/api/attachments';
import type { Attachment, DossierSlotValue, LinkedFileTypeValue } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { attachmentsKey } from './queryKeys';

type UploadVars = {
  file: File;
  description?: string | null;
  dossier_slot?: DossierSlotValue | null;
  linked_element_global_id?: string | null;
  linked_model_id?: string | null;
  linked_file_type?: LinkedFileTypeValue | null;
  anchor_x?: number | null;
  anchor_y?: number | null;
  anchor_z?: number | null;
  anchor_page?: number | null;
  linked_file_id?: string | null;
  capture_metadata?: Record<string, unknown> | null;
  onProgress?: (event: AttachmentUploadProgressEvent) => void;
};

export function useUploadAttachment(
  projectId: string,
): UseMutationResult<Attachment, Error, UploadVars> {
  return useAuthMutation({
    mutationFn: (accessToken, vars) => {
      const extra: {
        description?: string | null;
        dossier_slot?: DossierSlotValue | null;
        linked_element_global_id?: string | null;
        linked_model_id?: string | null;
        linked_file_type?: LinkedFileTypeValue | null;
        anchor_x?: number | null;
        anchor_y?: number | null;
        anchor_z?: number | null;
        anchor_page?: number | null;
        linked_file_id?: string | null;
        capture_metadata?: Record<string, unknown> | null;
      } = {};
      if (vars.description !== undefined) extra.description = vars.description;
      if (vars.dossier_slot !== undefined) extra.dossier_slot = vars.dossier_slot;
      if (vars.linked_element_global_id !== undefined) extra.linked_element_global_id = vars.linked_element_global_id;
      if (vars.linked_model_id !== undefined) extra.linked_model_id = vars.linked_model_id;
      if (vars.linked_file_type !== undefined) extra.linked_file_type = vars.linked_file_type;
      if (vars.anchor_x !== undefined) extra.anchor_x = vars.anchor_x;
      if (vars.anchor_y !== undefined) extra.anchor_y = vars.anchor_y;
      if (vars.anchor_z !== undefined) extra.anchor_z = vars.anchor_z;
      if (vars.anchor_page !== undefined) extra.anchor_page = vars.anchor_page;
      if (vars.linked_file_id !== undefined) extra.linked_file_id = vars.linked_file_id;
      if (vars.capture_metadata !== undefined) extra.capture_metadata = vars.capture_metadata;
      return uploadAttachmentEnd2End(
        accessToken,
        projectId,
        vars.file,
        extra,
        vars.onProgress,
      );
    },
    invalidateKeys: [attachmentsKey(projectId)],
  });
}
