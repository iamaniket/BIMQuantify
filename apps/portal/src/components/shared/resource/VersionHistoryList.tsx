/**
 * The inline version list rendered inside an expanded resource card. One shared
 * layout for Models (`ProjectFile[]`) and Certificates (version-history query):
 * the head version is tagged "latest", each row shows `v0n` + filename/size/date.
 * Callers normalise their data into `VersionEntry[]` (newest first).
 */
export type VersionEntry = {
  id: string;
  versionNumber: number;
  filename: string;
  sizeBytes?: number | null;
  createdAt?: string | null;
  uploadedByName?: string | null;
};
