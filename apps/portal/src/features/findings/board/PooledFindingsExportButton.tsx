'use client';

import { Download } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import { toast } from 'sonner';

import { Button, Spinner } from '@bimdossier/ui';

import { triggerBrowserDownload } from '@/lib/api/client';
import { downloadPooledFindingsCsv } from '@/lib/api/pooledFindings';
import { useAuth } from '@/providers/AuthProvider';

/**
 * Free-tier board CSV export. The paid `FindingsExportActions` pulls org-only
 * hooks (report generation, project permissions), so the free branch uses this
 * minimal button instead — it reuses the same `findingsBoard.export.*` strings
 * and hits the org-less `/pooled/projects/{id}/findings/export.csv` endpoint.
 */
export function PooledFindingsExportButton({ projectId }: { projectId: string }): JSX.Element {
  const t = useTranslations('findingsBoard.export');
  const { tokens } = useAuth();
  const accessToken = tokens?.access_token;
  const [pending, setPending] = useState(false);

  const handleCsv = async (): Promise<void> => {
    if (accessToken === undefined) return;
    setPending(true);
    try {
      const { blob, filename } = await downloadPooledFindingsCsv(accessToken, projectId);
      triggerBrowserDownload(blob, filename ?? `findings-${projectId}.csv`);
    } catch {
      toast.error(t('csvError'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      variant="border"
      size="md"
      className="shrink-0 whitespace-nowrap"
      disabled={pending || accessToken === undefined}
      onClick={() => { void handleCsv(); }}
    >
      {pending ? (
        <Spinner size="md" className="mr-1.5 h-3 w-3 text-current" />
      ) : (
        <Download className="mr-1.5 h-3 w-3" />
      )}
      {t('csv')}
    </Button>
  );
}
