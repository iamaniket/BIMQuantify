'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import { listCertificates } from '@/lib/api/certificates';
import type { Certificate, Project } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { getCertificateExpiryState } from './expiry';
import { certificatesKey } from './queryKeys';

export type ExpiringCertificatesSummary = {
  expiring: Certificate[];
  expired: Certificate[];
  total: number;
  isLoading: boolean;
  byProjectId: Map<string, { expiring: number; expired: number }>;
};

function expiringBeforeDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().slice(0, 10);
}

export function useExpiringCertificates(
  projects: Project[],
): ExpiringCertificatesSummary {
  const { tokens } = useAuth();
  const accessToken = tokens?.access_token ?? null;

  const activeProjects = useMemo(
    () => projects.filter((p) => p.lifecycle_state === 'active'),
    [projects],
  );

  const cutoff = useMemo(() => expiringBeforeDate(), []);

  const queries = useQueries({
    queries: activeProjects.map((project) => ({
      queryKey: [...certificatesKey(project.id), 'expiring', cutoff] as const,
      queryFn: () => {
        if (accessToken === null) {
          throw new Error('Not authenticated');
        }
        return listCertificates(accessToken, project.id, {
          expiringBefore: cutoff,
        });
      },
      enabled: accessToken !== null,
      staleTime: 5 * 60 * 1000,
    })),
  });

  return useMemo(() => {
    const expiring: Certificate[] = [];
    const expired: Certificate[] = [];
    const byProjectId = new Map<string, { expiring: number; expired: number }>();
    let loading = false;

    activeProjects.forEach((project, index) => {
      const query = queries[index];
      if (query === undefined) return;
      if (query.isLoading) loading = true;

      const certs = query.data ?? [];
      let projExpiring = 0;
      let projExpired = 0;

      for (const cert of certs) {
        const state = getCertificateExpiryState(cert.valid_until);
        if (state === 'expired') {
          expired.push(cert);
          projExpired++;
        } else if (state === 'expiring') {
          expiring.push(cert);
          projExpiring++;
        }
      }

      if (projExpiring > 0 || projExpired > 0) {
        byProjectId.set(project.id, { expiring: projExpiring, expired: projExpired });
      }
    });

    return {
      expiring,
      expired,
      total: expiring.length + expired.length,
      isLoading: loading,
      byProjectId,
    };
  }, [activeProjects, queries]);
}
