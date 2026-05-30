'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import {
  uploadCertificateEnd2End,
  type CertificateMetadataInput,
  type CertificateUploadProgressEvent,
} from '@/lib/api/certificates';
import type { Certificate } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { certificatesKey } from './queryKeys';

type UploadVars = {
  file: File;
  metadata: CertificateMetadataInput;
  onProgress?: (event: CertificateUploadProgressEvent) => void;
};

export function useUploadCertificate(
  projectId: string,
): UseMutationResult<Certificate, Error, UploadVars> {
  return useAuthMutation({
    mutationFn: (accessToken, vars) =>
      uploadCertificateEnd2End(
        accessToken,
        projectId,
        vars.file,
        vars.metadata,
        vars.onProgress,
      ),
    invalidateKeys: [certificatesKey(projectId)],
  });
}
