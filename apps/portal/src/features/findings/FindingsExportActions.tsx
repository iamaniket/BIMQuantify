'use client';

import { Download, Flag } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { AppDialog, Button, Select, Spinner } from '@bimdossier/ui';

import { UNASSIGNED_FILTER } from '@/features/findings/AssigneeFilterChips';
import { useProjectPermissions } from '@/features/permissions';
import { useGenerateReport } from '@/features/reports/hooks';
import { triggerBrowserDownload } from '@/lib/api/client';
import { downloadFindingsCsv } from '@/lib/api/findings';
import type {
  FindingSeverityValue,
  FindingStatusValue,
  ProjectMember,
} from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

const STATUSES: FindingStatusValue[] = ['draft', 'open', 'in_progress', 'resolved', 'verified'];
const SEVERITIES: FindingSeverityValue[] = ['high', 'medium', 'low'];

type Props = {
  projectId: string;
  members: ProjectMember[];
  /** Current board filters — used to scope the CSV and prefill the snag dialog. */
  severityFilter: FindingSeverityValue | undefined;
  assigneeFilter: Set<string>;
};

/** The single real assignee selected on the board (so we can scope a CSV /
 * prefill the snag recipient), or undefined when the selection is empty, the
 * "Unassigned" chip, or more than one chip. */
function singleAssignee(assigneeFilter: Set<string>): string | undefined {
  if (assigneeFilter.size !== 1) return undefined;
  const only = [...assigneeFilter][0];
  return only !== undefined && only !== UNASSIGNED_FILTER ? only : undefined;
}

export function FindingsExportActions({
  projectId,
  members,
  severityFilter,
  assigneeFilter,
}: Props): JSX.Element {
  const t = useTranslations('findingsBoard.export');
  const tColumns = useTranslations('findingsBoard.columns');
  const tSeverity = useTranslations('findings.severity');
  const { tokens } = useAuth();
  const accessToken = tokens?.access_token;
  const { can } = useProjectPermissions(projectId);
  const generate = useGenerateReport(projectId);

  const [csvPending, setCsvPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const [statusVal, setStatusVal] = useState('');
  const [severityVal, setSeverityVal] = useState('');

  const boardAssignee = useMemo(() => singleAssignee(assigneeFilter), [assigneeFilter]);

  const handleCsv = async (): Promise<void> => {
    if (accessToken === undefined) return;
    setCsvPending(true);
    try {
      const { blob, filename } = await downloadFindingsCsv(accessToken, projectId, {
        ...(severityFilter !== undefined ? { severity: severityFilter } : {}),
        ...(boardAssignee !== undefined ? { assigneeUserId: boardAssignee } : {}),
      });
      triggerBrowserDownload(blob, filename ?? `findings-${projectId}.csv`);
    } catch {
      toast.error(t('csvError'));
    } finally {
      setCsvPending(false);
    }
  };

  const openSnagDialog = (): void => {
    // Prefill from the active board filters so the dialog matches the view.
    setRecipientId(boardAssignee ?? '');
    setStatusVal('');
    setSeverityVal(severityFilter ?? '');
    setDialogOpen(true);
  };

  const handleGenerate = (): void => {
    generate.mutate(
      {
        report_type: 'snag_list',
        locale: null,
        params: {
          ...(recipientId !== '' ? { assignee_user_id: recipientId } : {}),
          ...(statusVal !== '' ? { status: statusVal } : {}),
          ...(severityVal !== '' ? { severity: severityVal } : {}),
        },
      },
      {
        onSuccess: () => {
          setDialogOpen(false);
          toast.success(t('success'));
        },
        onError: () => {
          toast.error(t('error'));
        },
      },
    );
  };

  return (
    <>
      <Button
        variant="border"
        size="md"
        className="shrink-0 whitespace-nowrap"
        disabled={csvPending || accessToken === undefined}
        onClick={() => { void handleCsv(); }}
      >
        {csvPending ? (
          <Spinner size="md" className="mr-1.5 h-3 w-3 text-current" />
        ) : (
          <Download className="mr-1.5 h-3 w-3" />
        )}
        {t('csv')}
      </Button>

      {can('report', 'create') && (
        <Button
          variant="border"
          size="md"
          className="shrink-0 whitespace-nowrap"
          onClick={openSnagDialog}
        >
          <Flag className="mr-1.5 h-3 w-3" />
          {t('snag')}
        </Button>
      )}

      <AppDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); }}
        title={t('dialogTitle')}
        subtitle={t('dialogSubtitle')}
        cancelLabel={t('cancel')}
        onSave={handleGenerate}
        saveLabel={generate.isPending ? t('generating') : t('generate')}
        saveDisabled={generate.isPending}
        width={460}
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-body3 font-medium text-foreground-secondary">
              {t('recipientLabel')}
            </span>
            <Select
              selectSize="md"
              value={recipientId}
              onChange={(e) => { setRecipientId(e.target.value); }}
            >
              <option value="">{t('recipientAll')}</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name ?? m.email}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-body3 font-medium text-foreground-secondary">
              {t('statusLabel')}
            </span>
            <Select
              selectSize="md"
              value={statusVal}
              onChange={(e) => { setStatusVal(e.target.value); }}
            >
              <option value="">{t('anyOption')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{tColumns(s)}</option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-body3 font-medium text-foreground-secondary">
              {t('severityLabel')}
            </span>
            <Select
              selectSize="md"
              value={severityVal}
              onChange={(e) => { setSeverityVal(e.target.value); }}
            >
              <option value="">{t('anyOption')}</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{tSeverity(s)}</option>
              ))}
            </Select>
          </label>
        </div>
      </AppDialog>
    </>
  );
}
