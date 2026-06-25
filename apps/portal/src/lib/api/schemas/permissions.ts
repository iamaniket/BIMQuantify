import { z } from 'zod';

// Mirrors the Action / Resource enums in the API's auth/permissions.py. These
// are stable string identifiers; the actual policy (which role may perform which
// action on which resource) stays on the server and is fetched at runtime via
// GET /permissions/matrix — never hard-coded here.

export const PermissionActionEnum = z.enum([
  'read',
  'create',
  'update',
  'delete',
  'archive',
  'invite',
  'publish',
  'sign',
]);

export type PermissionAction = z.infer<typeof PermissionActionEnum>;

export const PermissionResourceEnum = z.enum([
  'project',
  'document',
  'project_file',
  'member',
  'invitation',
  'inspection',
  'finding',
  'risk',
  'assurance_plan',
  'completion_declaration',
  'attachment',
  'certificate',
  'capture_link',
  'deadline',
  'audit_log',
  'compliance',
  'report',
  'bcf_topic',
]);

export type PermissionResource = z.infer<typeof PermissionResourceEnum>;

// role -> resource -> allowed action codes. Plain string-keyed records (not
// strict enums) so a server-side role/resource added ahead of the portal does
// not fail response validation — the portal simply won't gate the unknown
// entry until it's wired up. Input == output (no transforms) so apiClient
// response validation round-trips.
export const PermissionMatrixSchema = z.record(z.record(z.array(z.string())));

export type PermissionMatrix = z.infer<typeof PermissionMatrixSchema>;
