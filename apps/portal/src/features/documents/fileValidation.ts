// `.ifczip` is a compressed IFC — same `ifc` file type, so a model already
// locked to IFC must still accept it even though it doesn't end in `.ifc`.
const EXTENSIONS_BY_FILE_TYPE: Record<string, readonly string[]> = {
  ifc: ['.ifc', '.ifczip'],
  pdf: ['.pdf'],
  dxf: ['.dxf'],
  dwg: ['.dwg'],
};
const ALL_EXTENSIONS = ['.ifc', '.ifczip', '.pdf', '.dxf', '.dwg'] as const;

export function acceptedExtensions(lockedFileType: string | null): readonly string[] {
  if (lockedFileType !== null) {
    return EXTENSIONS_BY_FILE_TYPE[lockedFileType] ?? [`.${lockedFileType}`];
  }
  return ALL_EXTENSIONS;
}

export function isAllowedFile(file: File, lockedFileType: string | null): boolean {
  const lower = file.name.toLowerCase();
  return acceptedExtensions(lockedFileType).some((ext) => lower.endsWith(ext));
}
