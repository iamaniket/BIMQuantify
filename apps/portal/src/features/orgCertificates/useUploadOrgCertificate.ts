'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import {
  uploadOrgCertificateEnd2End,
  type OrgCertificateMetadataInput,
  type OrgCertificateUploadProgressEvent,
} from '@/lib/api/orgCertificates';
import type { OrgCertificate } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { orgCertificatesKey, orgCertificateStatsKey } from './queryKeys';

type UploadVars = {
  file: File;
  metadata: OrgCertificateMetadataInput;
  onProgress?: (event: OrgCertificateUploadProgressEvent) => void;
};

export function useUploadOrgCertificate(): UseMutationResult<OrgCertificate, Error, UploadVars> {
  return useAuthMutation({
    mutationFn: (accessToken, vars) =>
      uploadOrgCertificateEnd2End(
        accessToken,
        vars.file,
        vars.metadata,
        vars.onProgress,
      ),
    invalidateKeys: [orgCertificatesKey(), orgCertificateStatsKey()],
  });
}
