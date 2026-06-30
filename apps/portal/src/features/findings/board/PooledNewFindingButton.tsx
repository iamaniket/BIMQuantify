'use client';

import { Button, Input, Label, Select, Textarea } from '@bimdossier/ui';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { FormDialog } from '@/components/shared/FormDialog';
import { useDocuments } from '@/features/documents/useDocuments';
import { findingsKey } from '@/features/findings/queryKeys';
import { createPooledFinding } from '@/lib/api/pooledFindings';
import type { ProjectMember } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

type Severity = 'low' | 'medium' | 'high';
const SEVERITIES: Severity[] = ['low', 'medium', 'high'];

/**
 * Free-tier board "New finding" — paid `LogFindingButton` uses org templates, so
 * free users get this simpler dialog instead. A free snag REQUIRES a container
 * (`free_document_id`), so the dialog forces a container choice (defaulting when
 * there's exactly one). Board-created snags are anchor-less — they appear on the
 * board immediately and gain a 3D pin only when placed in the viewer.
 */
export function PooledNewFindingButton({
  projectId,
  members,
}: {
  projectId: string;
  members: ProjectMember[];
}): JSX.Element {
  const t = useTranslations('pooledViewer');
  const tForm = useTranslations('findings.form');
  const tSeverity = useTranslations('findings.severity');
  const { tokens } = useAuth();
  const accessToken = tokens?.access_token;
  const queryClient = useQueryClient();
  const documents = useDocuments(projectId).data ?? [];

  const [open, setOpen] = useState(false);
  const [containerId, setContainerId] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);

  // Default to the sole container; otherwise force an explicit choice.
  const defaultContainer = documents.length === 1 ? documents[0]?.id ?? '' : '';
  const effectiveContainer = containerId !== '' ? containerId : defaultContainer;

  const reset = (): void => {
    setContainerId('');
    setTitle('');
    setNote('');
    setSeverity('medium');
    setAssigneeId('');
    setDeadline('');
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (accessToken === undefined || title.trim() === '' || effectiveContainer === '') return;
    setBusy(true);
    void (async () => {
      try {
        await createPooledFinding(accessToken, effectiveContainer, {
          title: title.trim(),
          note: note.trim() === '' ? null : note.trim(),
          severity,
          assigned_to_user_id: assigneeId === '' ? null : assigneeId,
          deadline_date: deadline === '' ? null : deadline,
        });
        await queryClient.invalidateQueries({ queryKey: findingsKey(projectId) });
        reset();
        setOpen(false);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <Button
        variant="primary"
        size="lg"
        onClick={() => { setOpen(true); }}
        disabled={documents.length === 0}
      >
        {t('viewer.newFinding')}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
        title={t('viewer.newFinding')}
        description={t('viewer.boardCreateSubtitle')}
        onSubmit={onSubmit}
        submitLabel={t('viewer.addSnag')}
        cancelLabel={t('viewer.cancel')}
        submitDisabled={busy || title.trim() === '' || effectiveContainer === ''}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="free-board-container">{t('viewer.container')}</Label>
            <Select
              id="free-board-container"
              value={effectiveContainer}
              onChange={(e) => { setContainerId(e.target.value); }}
            >
              <option value="" disabled>
                —
              </option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="free-board-title">{tForm('fields.title')}</Label>
            <Input
              id="free-board-title"
              value={title}
              onChange={(e) => { setTitle(e.target.value); }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="free-board-note">{t('viewer.snagNote')}</Label>
            <Textarea
              id="free-board-note"
              rows={3}
              value={note}
              onChange={(e) => { setNote(e.target.value); }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="free-board-severity">{tForm('fields.severity')}</Label>
            <Select
              id="free-board-severity"
              value={severity}
              onChange={(e) => { setSeverity(e.target.value as Severity); }}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {tSeverity(s)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="free-board-assignee">{t('viewer.assignee')}</Label>
            <Select
              id="free-board-assignee"
              value={assigneeId}
              onChange={(e) => { setAssigneeId(e.target.value); }}
            >
              <option value="">{t('viewer.unassigned')}</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name ?? m.email}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="free-board-deadline">{t('viewer.deadline')}</Label>
            <Input
              id="free-board-deadline"
              type="date"
              value={deadline}
              onChange={(e) => { setDeadline(e.target.value); }}
            />
          </div>
        </div>
      </FormDialog>
    </>
  );
}
