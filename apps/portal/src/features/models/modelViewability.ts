import type { ProjectFile } from '@/lib/api/schemas';

/**
 * Whether a single model-source file can be opened in the viewer: a ready PDF
 * (2D), or any other type (IFC/DXF/DWG) whose geometry extraction succeeded.
 * Mirrors the per-row check in `ModelsTableRow` / `ModelsTab`.
 */
export function isFileViewable(file: ProjectFile): boolean {
  return file.file_type === 'pdf'
    ? file.status === 'ready'
    : file.extraction_status === 'succeeded';
}

/** Whether a model has at least one viewable/processed file inside it. */
export function isModelViewable(versions: ProjectFile[]): boolean {
  return versions.some(isFileViewable);
}
