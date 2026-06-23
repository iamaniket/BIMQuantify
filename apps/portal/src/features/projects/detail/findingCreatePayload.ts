import {
  anchorFieldsFromPoint,
  type FindingCreateInput,
  type FindingTemplate,
  type LinkedFileTypeValue,
} from '@/lib/api/schemas';

export type FindingCreateFormValues = {
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  bbl_article_ref?: string | undefined;
};

/**
 * Where the new finding is anchored when created from the viewer. `linkedModelId`
 * is the version-independent element identity; `linkedFileId` records the raised-on
 * version; `linkedPoint` + `linkedFileType` drive the flattened anchor columns.
 */
type FindingCreateLinkVars = {
  linkedModelId?: string | null | undefined;
  linkedFileId?: string | null | undefined;
  linkedElementGlobalId?: string | null | undefined;
  linkedPoint?: Record<string, number> | null | undefined;
  linkedFileType?: LinkedFileTypeValue | null | undefined;
};

export type FindingCreateExtra = {
  photoIds: string[];
  referenceAttachmentIds: string[];
  customValues: Record<string, unknown>;
  template?: FindingTemplate | null | undefined;
};

type BuildFindingCreateResult =
  | { ok: true; payload: FindingCreateInput }
  | { ok: false };

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  );
}

/**
 * Validate the required built-in + custom template fields and assemble the
 * create payload. Returns `{ ok: false }` when a required field is blank so the
 * caller can surface its own `requiredError` string (the API is the
 * authoritative backstop). Shared by `FindingFormDialog` (modal, used by
 * `LogFindingButton`) and the in-panel `FindingCreateForm`.
 */
export function buildFindingCreatePayload(
  values: FindingCreateFormValues,
  extra: FindingCreateExtra,
  link: FindingCreateLinkVars,
): BuildFindingCreateResult {
  const { template, photoIds, referenceAttachmentIds, customValues } = extra;
  const builtins = template?.builtin_fields ?? {};
  const showBbl = builtins['bbl_article_ref']?.visible !== false;
  const showPhotos = builtins['photos']?.visible !== false;
  const showReferences = builtins['references']?.visible !== false;
  const customFields = template?.fields ?? [];

  const bblValue = values.bbl_article_ref ?? '';

  if (showBbl && builtins['bbl_article_ref']?.required === true && isBlank(bblValue)) {
    return { ok: false };
  }
  if (showPhotos && builtins['photos']?.required === true && photoIds.length === 0) {
    return { ok: false };
  }
  if (
    showReferences &&
    builtins['references']?.required === true &&
    referenceAttachmentIds.length === 0
  ) {
    return { ok: false };
  }

  const customPayload: Record<string, unknown> = {};
  for (const field of customFields) {
    const value = customValues[field.id];
    if (field.type === 'checkbox') {
      const checked = value === true;
      if (field.required && !checked) return { ok: false };
      customPayload[field.id] = checked;
      continue;
    }
    if (isBlank(value)) {
      if (field.required) return { ok: false };
      continue;
    }
    customPayload[field.id] = value;
  }

  return {
    ok: true,
    payload: {
      title: values.title.trim(),
      description: values.description.trim(),
      severity: values.severity,
      bbl_article_ref: isBlank(bblValue) ? null : bblValue.trim(),
      linked_model_id: link.linkedModelId === undefined ? null : link.linkedModelId,
      linked_file_id: link.linkedFileId === undefined ? null : link.linkedFileId,
      linked_element_global_id:
        link.linkedElementGlobalId === undefined ? null : link.linkedElementGlobalId,
      ...anchorFieldsFromPoint(link.linkedFileType, link.linkedPoint),
      photo_ids: photoIds.length > 0 ? photoIds : undefined,
      reference_attachment_ids:
        referenceAttachmentIds.length > 0 ? referenceAttachmentIds : undefined,
      template_id: template != null ? template.id : null,
      custom_values: Object.keys(customPayload).length > 0 ? customPayload : undefined,
    },
  };
}
