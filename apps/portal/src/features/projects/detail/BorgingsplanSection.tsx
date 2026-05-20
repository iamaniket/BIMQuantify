'use client';

import {
  ChevronDown,
  ChevronUp,
  FileSignature,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent, type JSX } from 'react';

import { Badge, Button, Input, Label, Select, Textarea } from '@bimstitch/ui';

import { useBorgingsplanCatalog } from '@/features/borgingsplan/usePhaseLabels';
import { useBorgingsplan, useBorgingsplanVersions } from '@/features/borgingsplan/useBorgingsplan';
import {
  useCreateChecklistItem,
  useDeleteChecklistItem,
  useUpdateChecklistItem,
} from '@/features/borgingsplan/useChecklistItemMutations';
import {
  useCreateMoment,
  useDeleteMoment,
  useReorderMoments,
  useUpdateMoment,
} from '@/features/borgingsplan/useMomentMutations';
import {
  useGenerateBorgingsplan,
  useNewBorgingsplanVersion,
  usePublishBorgingsplan,
  useResetBorgingsplan,
} from '@/features/borgingsplan/usePlanMutations';
import type {
  Borgingsmoment,
  BorgingsmomentPhaseValue,
  Borgingsplan,
  BorgingsplanStatusValue,
  ChecklistItem,
  EvidenceTypeValue,
} from '@/lib/api/schemas';

const EVIDENCE_TYPES: readonly EvidenceTypeValue[] = [
  'photo',
  'certificate',
  'measurement',
  'document',
  'signature',
] as const;

const STATUS_BADGE_VARIANT: Record<
  BorgingsplanStatusValue,
  'info' | 'success' | 'default'
> = {
  draft: 'info',
  published: 'success',
  superseded: 'default',
};

type View = 'list' | 'timeline';

type Props = {
  projectId: string;
  country: string;
};

export function BorgingsplanSection({ projectId, country }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.plan');
  const catalog = useBorgingsplanCatalog(country);
  const planQuery = useBorgingsplan(projectId);
  const versionsQuery = useBorgingsplanVersions(projectId);
  const generateMutation = useGenerateBorgingsplan(projectId);
  const [view, setView] = useState<View>('list');

  if (catalog === null || planQuery.isLoading) {
    return (
      <div className="rounded-lg border border-border bg-background p-4 text-caption text-foreground-secondary">
        {t('loading')}
      </div>
    );
  }

  const plan = planQuery.data ?? null;

  if (plan === null) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background-secondary p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-body2 font-medium text-foreground">{t('emptyTitle')}</h3>
            <p className="text-caption text-foreground-secondary">{t('emptyDescription')}</p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => generateMutation.mutate({ force: false })}
            disabled={generateMutation.isPending}
          >
            {t('generate')}
          </Button>
        </div>
      </div>
    );
  }

  const readOnly = plan.status !== 'draft';
  const versionsCount = versionsQuery.data?.length ?? 1;

  return (
    <div className="flex flex-col gap-3">
      <PlanHeader
        projectId={projectId}
        plan={plan}
        readOnly={readOnly}
        versionsCount={versionsCount}
        view={view}
        onViewChange={setView}
      />

      {view === 'list' ? (
        <BorgingsplanListView
          projectId={projectId}
          country={country}
          plan={plan}
          readOnly={readOnly}
        />
      ) : (
        <BorgingsplanTimelineView
          country={country}
          plan={plan}
        />
      )}
    </div>
  );
}

type PlanHeaderProps = {
  projectId: string;
  plan: Borgingsplan;
  readOnly: boolean;
  versionsCount: number;
  view: View;
  onViewChange: (v: View) => void;
};

function PlanHeader({
  projectId,
  plan,
  readOnly,
  versionsCount,
  view,
  onViewChange,
}: PlanHeaderProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.plan');
  const publishMutation = usePublishBorgingsplan(projectId);
  const newVersionMutation = useNewBorgingsplanVersion(projectId);
  const resetMutation = useResetBorgingsplan(projectId);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge variant={STATUS_BADGE_VARIANT[plan.status]}>{t(`statuses.${plan.status}`)}</Badge>
          <span className="text-body2 font-medium text-foreground">
            {t('versionLabel', { version: plan.version_number })}
          </span>
          {versionsCount > 1 && (
            <span className="text-caption text-foreground-tertiary">
              · {t('historyLabel', { count: versionsCount })}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => onViewChange('list')}
              aria-pressed={view === 'list'}
              className={`px-2.5 py-1 text-caption ${
                view === 'list'
                  ? 'bg-foreground text-background'
                  : 'bg-background text-foreground-secondary hover:bg-background-secondary'
              }`}
            >
              {t('viewList')}
            </button>
            <button
              type="button"
              onClick={() => onViewChange('timeline')}
              aria-pressed={view === 'timeline'}
              className={`border-l border-border px-2.5 py-1 text-caption ${
                view === 'timeline'
                  ? 'bg-foreground text-background'
                  : 'bg-background text-foreground-secondary hover:bg-background-secondary'
              }`}
            >
              {t('viewTimeline')}
            </button>
          </div>

          {plan.status === 'draft' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmReset(true)}
                disabled={resetMutation.isPending}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                {t('reset')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
              >
                <FileSignature className="mr-1 h-3.5 w-3.5" />
                {t('publish')}
              </Button>
            </>
          )}

          {plan.status === 'published' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => newVersionMutation.mutate()}
              disabled={newVersionMutation.isPending}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {t('newVersion')}
            </Button>
          )}
        </div>
      </div>

      {readOnly && (
        <p className="mt-2 text-caption text-foreground-secondary">{t('readOnlyHint')}</p>
      )}

      {confirmReset && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-background-secondary p-3">
          <p className="text-caption text-foreground">{t('resetConfirm')}</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                resetMutation.mutate(plan.id);
                setConfirmReset(false);
              }}
              disabled={resetMutation.isPending}
            >
              {t('resetConfirmCta')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type ListViewProps = {
  projectId: string;
  country: string;
  plan: Borgingsplan;
  readOnly: boolean;
};

function BorgingsplanListView({
  projectId,
  country,
  plan,
  readOnly,
}: ListViewProps): JSX.Element {
  const catalog = useBorgingsplanCatalog(country);
  const t = useTranslations('projectDetail.tabs.borgingsplan.plan');
  if (catalog === null) return <></>;

  const momentsByPhase = useMemo(() => {
    const map = new Map<string, Borgingsmoment[]>();
    for (const moment of plan.moments) {
      const bucket = map.get(moment.phase) ?? [];
      bucket.push(moment);
      map.set(moment.phase, bucket);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.sequence_in_phase - b.sequence_in_phase);
    }
    return map;
  }, [plan.moments]);

  const phasesWithMoments = catalog.phases.filter(
    (p) => (momentsByPhase.get(p.code) ?? []).length > 0 || p.code === 'other' || !readOnly,
  );

  return (
    <div className="flex flex-col gap-3">
      {phasesWithMoments.length === 0 && (
        <p className="text-caption text-foreground-secondary">{t('listEmpty')}</p>
      )}
      {phasesWithMoments.map((phase) => (
        <PhaseSection
          key={phase.code}
          projectId={projectId}
          plan={plan}
          phase={phase}
          moments={momentsByPhase.get(phase.code) ?? []}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

type PhaseSectionProps = {
  projectId: string;
  plan: Borgingsplan;
  phase: { code: string; label: string };
  moments: Borgingsmoment[];
  readOnly: boolean;
};

function PhaseSection({
  projectId,
  plan,
  phase,
  moments,
  readOnly,
}: PhaseSectionProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.plan');
  const [open, setOpen] = useState(true);
  const [showAddMoment, setShowAddMoment] = useState(false);
  const reorderMutation = useReorderMoments(projectId, plan.id);

  const moveBy = (idx: number, delta: number): void => {
    const target = idx + delta;
    if (target < 0 || target >= moments.length) return;
    const next = moments.slice();
    const [removed] = next.splice(idx, 1);
    if (removed === undefined) return;
    next.splice(target, 0, removed);
    reorderMutation.mutate({
      phase: phase.code as BorgingsmomentPhaseValue,
      moment_ids: next.map((m) => m.id),
    });
  };

  return (
    <section className="rounded-lg border border-border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-t-lg px-4 py-3 text-left hover:bg-background-secondary"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <ChevronDown
            className={`h-4 w-4 text-foreground-secondary transition-transform ${
              open ? '' : '-rotate-90'
            }`}
            aria-hidden
          />
          <span className="text-body2 font-medium text-foreground">{phase.label}</span>
          <span className="rounded-full bg-background-tertiary px-2 py-0.5 text-caption tabular-nums text-foreground-secondary">
            {moments.length}
          </span>
        </div>
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-3">
          {moments.length === 0 && (
            <p className="text-caption text-foreground-secondary">{t('phaseEmpty')}</p>
          )}

          {moments.map((moment, idx) => (
            <MomentRow
              key={moment.id}
              projectId={projectId}
              planId={plan.id}
              moment={moment}
              readOnly={readOnly}
              canMoveUp={idx > 0}
              canMoveDown={idx < moments.length - 1}
              onMoveUp={() => moveBy(idx, -1)}
              onMoveDown={() => moveBy(idx, 1)}
            />
          ))}

          {!readOnly && (
            <div className="flex justify-end pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddMoment((v) => !v)}
                aria-expanded={showAddMoment}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {showAddMoment ? t('cancel') : t('addMoment')}
              </Button>
            </div>
          )}

          {showAddMoment && (
            <AddMomentForm
              projectId={projectId}
              planId={plan.id}
              defaultPhase={phase.code as BorgingsmomentPhaseValue}
              onDone={() => setShowAddMoment(false)}
            />
          )}
        </div>
      )}
    </section>
  );
}

type MomentRowProps = {
  projectId: string;
  planId: string;
  moment: Borgingsmoment;
  readOnly: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

function MomentRow({
  projectId,
  planId,
  moment,
  readOnly,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: MomentRowProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.plan');
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const deleteMutation = useDeleteMoment(projectId, planId);

  return (
    <div className="rounded-md border border-border bg-background-secondary">
      <div className="flex items-start justify-between gap-2 p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-start gap-2 text-left"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={`mt-1 h-4 w-4 shrink-0 text-foreground-tertiary transition-transform ${
              expanded ? '' : '-rotate-90'
            }`}
            aria-hidden
          />
          <div className="flex flex-1 flex-col">
            <span className="text-body3 font-medium text-foreground">{moment.name}</span>
            <span className="text-caption text-foreground-tertiary">
              {t('plannedDateLabel')}: {moment.planned_date}
              {moment.actual_date !== null && (
                <> · {t('actualDateLabel')}: {moment.actual_date}</>
              )}
            </span>
          </div>
        </button>

        {!readOnly && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="text-foreground-tertiary hover:text-foreground disabled:opacity-30"
              aria-label={t('moveUp')}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="text-foreground-tertiary hover:text-foreground disabled:opacity-30"
              aria-label={t('moveDown')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="text-foreground-tertiary hover:text-foreground"
              aria-label={t('edit')}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => deleteMutation.mutate(moment.id)}
              disabled={deleteMutation.isPending}
              className="text-foreground-tertiary hover:text-error disabled:opacity-50"
              aria-label={t('deleteMoment')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {editing && !readOnly && (
        <div className="border-t border-border p-3">
          <EditMomentForm
            projectId={projectId}
            planId={planId}
            moment={moment}
            onDone={() => setEditing(false)}
          />
        </div>
      )}

      {expanded && (
        <div className="flex flex-col gap-2 border-t border-border p-3">
          {moment.checklist_items.length === 0 && (
            <p className="text-caption text-foreground-secondary">{t('checklistEmpty')}</p>
          )}
          {moment.checklist_items.map((it) => (
            <ChecklistItemRow
              key={it.id}
              projectId={projectId}
              momentId={moment.id}
              item={it}
              readOnly={readOnly}
            />
          ))}
          {!readOnly && (
            <div className="flex justify-end pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddItem((v) => !v)}
                aria-expanded={showAddItem}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {showAddItem ? t('cancel') : t('addChecklistItem')}
              </Button>
            </div>
          )}
          {showAddItem && (
            <AddChecklistItemForm
              projectId={projectId}
              momentId={moment.id}
              onDone={() => setShowAddItem(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

type ChecklistItemRowProps = {
  projectId: string;
  momentId: string;
  item: ChecklistItem;
  readOnly: boolean;
};

function ChecklistItemRow({
  projectId,
  momentId,
  item,
  readOnly,
}: ChecklistItemRowProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.plan');
  const tItem = useTranslations('projectDetail.tabs.borgingsplan.plan.evidenceTypes');
  const deleteMutation = useDeleteChecklistItem(projectId, momentId);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="rounded border border-border bg-background p-2">
        <EditChecklistItemForm
          projectId={projectId}
          momentId={momentId}
          item={item}
          onDone={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-2 rounded border border-border bg-background p-2">
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">{tItem(item.evidence_type)}</Badge>
          {item.bbl_article_ref !== null && (
            <span className="text-caption text-foreground-tertiary">
              {t('bblArticlePrefix')} {item.bbl_article_ref}
            </span>
          )}
        </div>
        <p className="text-body3 text-foreground">{item.description}</p>
        {item.pass_fail_criteria !== null && item.pass_fail_criteria.length > 0 && (
          <p className="text-caption text-foreground-tertiary">
            {t('passFailLabel')}: {item.pass_fail_criteria}
          </p>
        )}
      </div>
      {!readOnly && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-foreground-tertiary hover:text-foreground"
            aria-label={t('edit')}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => deleteMutation.mutate(item.id)}
            disabled={deleteMutation.isPending}
            className="text-foreground-tertiary hover:text-error disabled:opacity-50"
            aria-label={t('deleteItem')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

type AddMomentFormProps = {
  projectId: string;
  planId: string;
  defaultPhase: BorgingsmomentPhaseValue;
  onDone: () => void;
};

function AddMomentForm({
  projectId,
  planId,
  defaultPhase,
  onDone,
}: AddMomentFormProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.plan');
  const create = useCreateMoment(projectId, planId);
  const [name, setName] = useState('');
  const [plannedDate, setPlannedDate] = useState(new Date().toISOString().slice(0, 10));

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    create.mutate(
      { phase: defaultPhase, name: trimmed, planned_date: plannedDate },
      {
        onSuccess: () => {
          setName('');
          onDone();
        },
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
    >
      <div className="flex flex-col gap-1">
        <Label className="text-caption text-foreground-secondary">{t('nameLabel')}</Label>
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={255}
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-caption text-foreground-secondary">{t('plannedDateLabel')}</Label>
        <Input
          type="date"
          value={plannedDate}
          onChange={(e) => setPlannedDate(e.target.value)}
          required
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={create.isPending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

type EditMomentFormProps = {
  projectId: string;
  planId: string;
  moment: Borgingsmoment;
  onDone: () => void;
};

function EditMomentForm({
  projectId,
  planId,
  moment,
  onDone,
}: EditMomentFormProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.plan');
  const update = useUpdateMoment(projectId, planId);
  const [name, setName] = useState(moment.name);
  const [plannedDate, setPlannedDate] = useState(moment.planned_date);
  const [actualDate, setActualDate] = useState(moment.actual_date ?? '');
  const [notes, setNotes] = useState(moment.notes ?? '');

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    update.mutate(
      {
        momentId: moment.id,
        input: {
          name: name.trim(),
          planned_date: plannedDate,
          actual_date: actualDate.length > 0 ? actualDate : null,
          notes: notes.trim().length > 0 ? notes.trim() : null,
        },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <Label className="text-caption text-foreground-secondary">{t('nameLabel')}</Label>
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={255}
          required
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label className="text-caption text-foreground-secondary">{t('plannedDateLabel')}</Label>
          <Input
            type="date"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-caption text-foreground-secondary">{t('actualDateLabel')}</Label>
          <Input
            type="date"
            value={actualDate}
            onChange={(e) => setActualDate(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-caption text-foreground-secondary">{t('notesLabel')}</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={4000}
          rows={2}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={update.isPending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

type AddChecklistItemFormProps = {
  projectId: string;
  momentId: string;
  onDone: () => void;
};

function AddChecklistItemForm({
  projectId,
  momentId,
  onDone,
}: AddChecklistItemFormProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.plan');
  const tEv = useTranslations('projectDetail.tabs.borgingsplan.plan.evidenceTypes');
  const create = useCreateChecklistItem(projectId, momentId);
  const [description, setDescription] = useState('');
  const [evidenceType, setEvidenceType] = useState<EvidenceTypeValue>('photo');
  const [bblArticleRef, setBblArticleRef] = useState('');
  const [passFail, setPassFail] = useState('');

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = description.trim();
    if (trimmed.length === 0) return;
    create.mutate(
      {
        description: trimmed,
        evidence_type: evidenceType,
        bbl_article_ref: bblArticleRef.trim().length > 0 ? bblArticleRef.trim() : null,
        pass_fail_criteria: passFail.trim().length > 0 ? passFail.trim() : null,
      },
      {
        onSuccess: () => {
          setDescription('');
          setBblArticleRef('');
          setPassFail('');
          onDone();
        },
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
    >
      <div className="flex flex-col gap-1">
        <Label className="text-caption text-foreground-secondary">{t('descriptionLabel')}</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
          rows={2}
          required
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label className="text-caption text-foreground-secondary">{t('evidenceTypeLabel')}</Label>
          <Select
            value={evidenceType}
            onChange={(e) => setEvidenceType(e.target.value as EvidenceTypeValue)}
          >
            {EVIDENCE_TYPES.map((ev) => (
              <option key={ev} value={ev}>
                {tEv(ev)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-caption text-foreground-secondary">{t('bblArticleLabel')}</Label>
          <Input
            type="text"
            value={bblArticleRef}
            onChange={(e) => setBblArticleRef(e.target.value)}
            placeholder={t('bblArticlePlaceholder')}
            maxLength={50}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-caption text-foreground-secondary">{t('passFailLabel')}</Label>
          <Input
            type="text"
            value={passFail}
            onChange={(e) => setPassFail(e.target.value)}
            maxLength={4000}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={create.isPending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

type EditChecklistItemFormProps = {
  projectId: string;
  momentId: string;
  item: ChecklistItem;
  onDone: () => void;
};

function EditChecklistItemForm({
  projectId,
  momentId,
  item,
  onDone,
}: EditChecklistItemFormProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.plan');
  const tEv = useTranslations('projectDetail.tabs.borgingsplan.plan.evidenceTypes');
  const update = useUpdateChecklistItem(projectId, momentId);
  const [description, setDescription] = useState(item.description);
  const [evidenceType, setEvidenceType] = useState<EvidenceTypeValue>(item.evidence_type);
  const [bblArticleRef, setBblArticleRef] = useState(item.bbl_article_ref ?? '');
  const [passFail, setPassFail] = useState(item.pass_fail_criteria ?? '');

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = description.trim();
    if (trimmed.length === 0) return;
    update.mutate(
      {
        itemId: item.id,
        input: {
          description: trimmed,
          evidence_type: evidenceType,
          bbl_article_ref: bblArticleRef.trim().length > 0 ? bblArticleRef.trim() : null,
          pass_fail_criteria: passFail.trim().length > 0 ? passFail.trim() : null,
        },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        maxLength={4000}
        required
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select
          value={evidenceType}
          onChange={(e) => setEvidenceType(e.target.value as EvidenceTypeValue)}
        >
          {EVIDENCE_TYPES.map((ev) => (
            <option key={ev} value={ev}>
              {tEv(ev)}
            </option>
          ))}
        </Select>
        <Input
          type="text"
          value={bblArticleRef}
          onChange={(e) => setBblArticleRef(e.target.value)}
          placeholder="bv. 4.51"
          maxLength={50}
        />
        <Input
          type="text"
          value={passFail}
          onChange={(e) => setPassFail(e.target.value)}
          placeholder={t('passFailLabel')}
          maxLength={4000}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={update.isPending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Timeline view
// ---------------------------------------------------------------------------

type TimelineViewProps = {
  country: string;
  plan: Borgingsplan;
};

const PHASE_COLOR: Record<BorgingsmomentPhaseValue, string> = {
  foundation: 'bg-amber-500',
  shell: 'bg-indigo-500',
  roof: 'bg-emerald-500',
  finishing: 'bg-rose-500',
  handover: 'bg-violet-500',
  other: 'bg-slate-500',
};

function BorgingsplanTimelineView({ country, plan }: TimelineViewProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.plan');
  const catalog = useBorgingsplanCatalog(country);
  const moments = useMemo(() => {
    return plan.moments
      .slice()
      .sort((a, b) => a.planned_date.localeCompare(b.planned_date));
  }, [plan.moments]);

  if (moments.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background p-4 text-caption text-foreground-secondary">
        {t('timelineEmpty')}
      </div>
    );
  }

  const firstDate = new Date(moments[0]!.planned_date);
  const lastDate = new Date(moments[moments.length - 1]!.planned_date);
  const totalDays = Math.max(
    1,
    Math.round((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)) + 7,
  );
  const pxPerDay = 6;
  const widthPx = Math.max(320, totalDays * pxPerDay);

  const phaseLabel = (code: string): string => {
    if (catalog === null) return code;
    return catalog.phases.find((p) => p.code === code)?.label ?? code;
  };

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="overflow-x-auto">
        <ol className="flex flex-col gap-1" style={{ minWidth: `${widthPx}px` }}>
          {moments.map((m) => {
            const offsetDays = Math.round(
              (new Date(m.planned_date).getTime() - firstDate.getTime()) /
                (1000 * 60 * 60 * 24),
            );
            return (
              <li key={m.id} className="flex items-center gap-2">
                <div className="w-40 shrink-0 truncate text-caption text-foreground-secondary">
                  {phaseLabel(m.phase)}
                </div>
                <div className="relative flex-1" style={{ height: '24px' }}>
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-caption text-white ${
                      PHASE_COLOR[m.phase]
                    }`}
                    style={{
                      left: `${offsetDays * pxPerDay}px`,
                      maxWidth: `${Math.max(96, m.name.length * 8)}px`,
                    }}
                    title={`${m.name} · ${m.planned_date}`}
                  >
                    <span className="truncate">{m.name}</span>
                  </div>
                </div>
                <div className="w-24 shrink-0 text-right text-caption tabular-nums text-foreground-tertiary">
                  {m.planned_date}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
