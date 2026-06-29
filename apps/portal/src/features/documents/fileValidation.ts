// `.ifczip` is a compressed IFC — same `ifc` file type, so a model already
// locked to IFC must still accept it even though it doesn't end in `.ifc`.
const EXTENSIONS_BY_FILE_TYPE: Record<string, readonly string[]> = {
  ifc: ['.ifc', '.ifczip'],
  pdf: ['.pdf'],
  dxf: ['.dxf'],
  dwg: ['.dwg'],
};
const ALL_EXTENSIONS = ['.ifc', '.ifczip', '.pdf', '.dxf', '.dwg'] as const;
// The free tier accepts IFC (3D) + PDF (2D drawings) only — no DXF/DWG (the
// backend rejects those with INVALID_FILE_EXTENSION).
const FREE_EXTENSIONS = ['.ifc', '.ifczip', '.pdf'] as const;

export function acceptedExtensions(
  lockedFileType: string | null,
  free = false,
): readonly string[] {
  if (lockedFileType !== null) {
    return EXTENSIONS_BY_FILE_TYPE[lockedFileType] ?? [`.${lockedFileType}`];
  }
  return free ? FREE_EXTENSIONS : ALL_EXTENSIONS;
}

export function isAllowedFile(file: File, lockedFileType: string | null, free = false): boolean {
  const lower = file.name.toLowerCase();
  return acceptedExtensions(lockedFileType, free).some((ext) => lower.endsWith(ext));
}
