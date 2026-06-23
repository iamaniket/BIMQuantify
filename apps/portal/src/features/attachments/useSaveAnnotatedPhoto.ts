'use client';

import { ANNOTATION_SCHEMA_VERSION, exportAnnotatedImage, type Annotation2D } from '@bimstitch/annotation';
import type { UseMutationResult } from '@tanstack/react-query';

import { updateAttachment, uploadAttachmentEnd2End } from '@/lib/api/attachments';
import type { Attachment } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { attachmentsKey } from './queryKeys';

type SaveAnnotatedPhotoVars = {
  /** The current head attachment being annotated (the new burn supersedes it). */
  attachment: Attachment;
  /** The vector annotations to burn + persist. */
  annotations: Annotation2D[];
  /** Presigned URL of the ORIGINAL (un-annotated) image — burned from to avoid quality loss. */
  originalImageUrl: string;
  /** Attachment version id of that original (kept on the new version for re-editing). */
  sourceVersionId: string;
};

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * Save an annotated photo: flatten the vectors onto a fresh raster (burned from
 * the original), upload it as the next version of the attachment, and store the
 * vectors on the new version so the markup stays re-editable. Returns the new
 * (head) attachment.
 */
export function useSaveAnnotatedPhoto(
  projectId: string,
): UseMutationResult<Attachment, Error, SaveAnnotatedPhotoVars> {
  return useAuthMutation({
    mutationFn: async (accessToken, vars) => {
      const isPng = vars.attachment.content_type === 'image/png';
      const mimeType = isPng ? 'image/png' : 'image/jpeg';
      const blob = await exportAnnotatedImage(vars.originalImageUrl, vars.annotations, { mimeType });

      const stem = stripExtension(vars.attachment.original_filename) || 'photo';
      const file = new File([blob], `${stem}-annotated.${isPng ? 'png' : 'jpg'}`, { type: blob.type });

      const uploaded = await uploadAttachmentEnd2End(accessToken, projectId, file, {
        supersedes_id: vars.attachment.id,
        dossier_slot: vars.attachment.dossier_slot,
      });

      return updateAttachment(accessToken, projectId, uploaded.id, {
        annotation_state: {
          schemaVersion: ANNOTATION_SCHEMA_VERSION,
          sourceVersionId: vars.sourceVersionId,
          annotations: vars.annotations,
        },
      });
    },
    invalidateKeys: [attachmentsKey(projectId)],
  });
}
