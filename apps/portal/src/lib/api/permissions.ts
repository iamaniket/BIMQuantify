import { apiClient } from './client';
import { PermissionMatrixSchema, type PermissionMatrix } from './schemas';

export async function getPermissionMatrix(accessToken: string): Promise<PermissionMatrix> {
  return apiClient.get<PermissionMatrix>(
    '/permissions/matrix',
    PermissionMatrixSchema,
    accessToken,
  );
}
