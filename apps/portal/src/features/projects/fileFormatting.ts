import type { ExtractionStatusValue, IfcSchemaValue } from '@/lib/api/schemas';

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

export function formatFileSize(bytes: number): string {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MB`;
  if (bytes >= KIB) return `${(bytes / KIB).toFixed(0)} KB`;
  return `${String(bytes)} B`;
}

export function formatRejection(reason: string | null): string {
  if (reason === null) return '';
  switch (reason) {
    case 'FILE_NOT_ISO_10303_21':
      return 'Not a valid IFC/STEP file (missing ISO-10303-21 header).';
    case 'FILE_SCHEMA_MISSING':
      return 'IFC file is missing FILE_SCHEMA declaration.';
    case 'FILE_SCHEMA_UNSUPPORTED':
      return 'IFC schema is not one of IFC2X3, IFC4, IFC4X3.';
    default:
      return reason;
  }
}

export function formatSchemaLabel(schema: IfcSchemaValue | null): string {
  if (schema === null) return '—';
  if (schema === 'unknown') return 'Unknown';
  return schema;
}

export function formatExtractionStatus(status: ExtractionStatusValue): string {
  switch (status) {
    case 'not_started': return 'Pending';
    case 'queued': return 'Queued';
    case 'running': return 'Processing';
    case 'succeeded': return 'Ready';
    case 'failed': return 'Failed';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
