'use client';

import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import { Badge, Button, Input, Label, Textarea } from '@bimstitch/ui';

import {
  type Risk,
  type RiskCategoryValue,
  type RiskCreateInput,
  type RiskLevelValue,
} from '@/lib/api/schemas';
import type { JurisdictionRiskTemplate } from '@/lib/api/jurisdictions';

import { useBblRiskCatalog } from '@/features/risks/useBblRiskCatalog';
import { useCreateRisk } from '@/features/risks/useCreateRisk';
import { useDeleteRisk } from '@/features/risks/useDeleteRisk';
import { useRisks } from '@/features/risks/useRisks';
import { useUpdateRisk } from '@/features/risks/useUpdateRisk';

type Props = {
  projectId: string;
  country: string;
};

const LEVELS: readonly RiskLevelValue[] = ['low', 'medium', 'high'] as const;

const LEVEL_BADGE_VARIANT: Record<RiskLevelValue, 'info' | 'warning' | 'error'> = {
  low: 'info',
  medium: 'warning',
  high: 'error',
};

export function RiskAssessmentSection({ projectId, country }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.risks');
  const catalog = useBblRiskCatalog(country);
  const risksQuery = useRisks(projectId);

  if (catalog === null || risksQuery.data === undefined) {
    return (
      <div className="rounded-lg border border-border bg-background p-4 text-caption text-foreground-secondary">
        {t('loading')}
      </div>
    );
  }

  const risksByCategory = new Map<string, Risk[]>();
  for (const risk of risksQuery.data) {
    const bucket = risksByCategory.get(risk.category) ?? [];
    bucket.push(risk);
    risksByCategory.set(risk.category, bucket);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-body1 font-semibold text-foreground">{t('heading')}</h2>
        <p className="text-caption text-foreground-secondary">{t('subheading')}</p>
      </div>

      {catalog.categories.map(({ code, label }) => (
        <CategorySection
          key={code}
          projectId={projectId}
          category={code as RiskCategoryValue}
          label={label}
          templates={catalog.templatesByCategory[code] ?? []}
          risks={risksByCategory.get(code) ?? []}
        />
      ))}
    </div>
  );
}

type CategorySectionProps = {
  projectId: string;
  category: RiskCategoryValue;
  label: string;
  templates: JurisdictionRiskTemplate[];
  risks: Risk[];
};

function CategorySection({
  projectId,
  category,
  label,
  templates,
  risks,
}: CategorySectionProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.risks');
  const [open, setOpen] = useState(true);
  const [showCustomForm, setShowCustomForm] = useState(false);

  // A template is "available" if no existing risk on this project carries its
  // title. Description-based check would be more robust but title is enough
  // for MVP — adopted-then-edited templates re-appear, which is fine.
  const adoptedTitles = useMemo(
    () => new Set(risks.map((r) => r.description.split('\n')[0])),
    [risks],
  );
  const availableTemplates = templates.filter((tpl) => !adoptedTitles.has(tpl.title));

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
          <span className="text-body2 font-medium text-foreground">{label}</span>
          <span className="rounded-full bg-background-tertiary px-2 py-0.5 text-caption tabular-nums text-foreground-secondary">
            {risks.length}
          </span>
        </div>
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-3">
          {risks.length === 0 && (
            <p className="text-caption text-foreground-secondary">{t('emptyCategory')}</p>
          )}

          {risks.map((risk) => (
            <RiskRow key={risk.id} projectId={projectId} risk={risk} />
          ))}

          {availableTemplates.length > 0 && (
            <details className="mt-1 rounded-md border border-dashed border-border bg-background-secondary p-2">
              <summary className="cursor-pointer text-caption font-medium text-foreground-secondary">
                {t('templatePickerLabel', { count: availableTemplates.length })}
              </summary>
              <div className="mt-2 flex flex-col gap-1">
                {availableTemplates.map((tpl) => (
                  <TemplateRow
                    key={tpl.code}
                    projectId={projectId}
                    category={category}
                    template={tpl}
                  />
                ))}
              </div>
            </details>
          )}

          <div className="flex justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCustomForm((v) => !v)}
              aria-expanded={showCustomForm}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {showCustomForm ? t('cancelCustom') : t('addCustom')}
            </Button>
          </div>

          {showCustomForm && (
            <CustomRiskForm
              projectId={projectId}
              category={category}
              onDone={() => setShowCustomForm(false)}
            />
          )}
        </div>
      )}
    </section>
  );
}

type RiskRowProps = {
  projectId: string;
  risk: Risk;
};

function RiskRow({ projectId, risk }: RiskRowProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.risks');
  const deleteMutation = useDeleteRisk(projectId);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <RiskEditForm
        projectId={projectId}
        risk={risk}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-background-secondary p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={LEVEL_BADGE_VARIANT[risk.level]}>{t(`levels.${risk.level}`)}</Badge>
          {risk.bbl_article_ref !== null && (
            <span className="text-caption text-foreground-tertiary">
              {t('bblArticlePrefix')} {risk.bbl_article_ref}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-foreground-tertiary hover:text-foreground"
            aria-label={t('editRisk')}
            title={t('editRisk')}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => deleteMutation.mutate(risk.id)}
            disabled={deleteMutation.isPending}
            className="text-foreground-tertiary hover:text-error disabled:opacity-50"
            aria-label={t('deleteRisk')}
            title={t('deleteRisk')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <p className="text-body3 text-foreground">{risk.description}</p>
      <p className="text-caption text-foreground-secondary">
        <span className="font-medium text-foreground-tertiary">{t('mitigationLabel')}:</span>{' '}
        {risk.mitigation}
      </p>
      {risk.responsible_party !== null && risk.responsible_party.length > 0 && (
        <p className="text-caption text-foreground-tertiary">
          {t('responsibleLabel')}: {risk.responsible_party}
        </p>
      )}
    </div>
  );
}

type RiskEditFormProps = {
  projectId: string;
  risk: Risk;
  onDone: () => void;
};

function RiskEditForm({ projectId, risk, onDone }: RiskEditFormProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.risks');
  const updateMutation = useUpdateRisk(projectId);
  const [level, setLevel] = useState<RiskLevelValue>(risk.level);
  const [description, setDescription] = useState(risk.description);
  const [mitigation, setMitigation] = useState(risk.mitigation);
  const [responsibleParty, setResponsibleParty] = useState(risk.responsible_party ?? '');
  const [bblArticle, setBblArticle] = useState(risk.bbl_article_ref ?? '');

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmedDesc = description.trim();
    const trimmedMit = mitigation.trim();
    if (trimmedDesc.length === 0 || trimmedMit.length === 0) return;
    updateMutation.mutate(
      {
        riskId: risk.id,
        input: {
          level,
          description: trimmedDesc,
          mitigation: trimmedMit,
          responsible_party: responsibleParty.trim().length > 0 ? responsibleParty.trim() : null,
          bbl_article_ref: bblArticle.trim().length > 0 ? bblArticle.trim() : null,
        },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
    >
      <div className="flex flex-col gap-1">
        <Label className="text-caption text-foreground-secondary">{t('descriptionLabel')}</Label>
        <Input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          required
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-caption text-foreground-secondary">{t('mitigationLabel')}</Label>
        <Textarea
          value={mitigation}
          onChange={(e) => setMitigation(e.target.value)}
          maxLength={2000}
          rows={2}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label className="text-caption text-foreground-secondary">{t('levelLabel')}</Label>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevel(lvl)}
                aria-pressed={level === lvl}
                className={`flex-1 px-2 py-1 text-caption capitalize ${
                  level === lvl
                    ? 'bg-foreground text-background'
                    : 'bg-background text-foreground-secondary hover:bg-background-secondary'
                }`}
              >
                {t(`levels.${lvl}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-caption text-foreground-secondary">{t('responsibleLabel')}</Label>
          <Input
            type="text"
            value={responsibleParty}
            onChange={(e) => setResponsibleParty(e.target.value)}
            maxLength={255}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-caption text-foreground-secondary">{t('bblArticleLabel')}</Label>
          <Input
            type="text"
            value={bblArticle}
            onChange={(e) => setBblArticle(e.target.value)}
            placeholder={t('bblArticlePlaceholder')}
            maxLength={50}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t('cancelEdit')}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={updateMutation.isPending}>
          {t('saveEdit')}
        </Button>
      </div>
    </form>
  );
}

type TemplateRowProps = {
  projectId: string;
  category: RiskCategoryValue;
  template: JurisdictionRiskTemplate;
};

function TemplateRow({ projectId, category, template }: TemplateRowProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.risks');
  const createMutation = useCreateRisk(projectId);

  const adopt = (): void => {
    const input: RiskCreateInput = {
      category,
      level: 'medium',
      description: template.title,
      mitigation: template.description,
      responsible_party: null,
      bbl_article_ref: template.default_bbl_article ?? null,
    };
    createMutation.mutate(input);
  };

  return (
    <button
      type="button"
      onClick={adopt}
      disabled={createMutation.isPending}
      className="group flex w-full items-center justify-between gap-2 rounded border border-transparent bg-background px-2 py-1.5 text-left text-body3 text-foreground hover:border-border hover:bg-background-tertiary disabled:opacity-50"
    >
      <span className="flex flex-col">
        <span className="font-medium">{template.title}</span>
        {template.default_bbl_article !== null && (
          <span className="text-caption text-foreground-tertiary">
            {t('bblArticlePrefix')} {template.default_bbl_article}
          </span>
        )}
      </span>
      <Plus className="h-3.5 w-3.5 text-foreground-tertiary group-hover:text-foreground" />
    </button>
  );
}

type CustomRiskFormProps = {
  projectId: string;
  category: RiskCategoryValue;
  onDone: () => void;
};

function CustomRiskForm({ projectId, category, onDone }: CustomRiskFormProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan.risks');
  const createMutation = useCreateRisk(projectId);
  const [level, setLevel] = useState<RiskLevelValue>('medium');
  const [description, setDescription] = useState('');
  const [mitigation, setMitigation] = useState('');
  const [responsibleParty, setResponsibleParty] = useState('');
  const [bblArticle, setBblArticle] = useState('');

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmedDesc = description.trim();
    const trimmedMit = mitigation.trim();
    if (trimmedDesc.length === 0 || trimmedMit.length === 0) return;
    createMutation.mutate(
      {
        category,
        level,
        description: trimmedDesc,
        mitigation: trimmedMit,
        responsible_party: responsibleParty.trim().length > 0 ? responsibleParty.trim() : null,
        bbl_article_ref: bblArticle.trim().length > 0 ? bblArticle.trim() : null,
      },
      {
        onSuccess: () => {
          setDescription('');
          setMitigation('');
          setResponsibleParty('');
          setBblArticle('');
          setLevel('medium');
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
        <Input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('descriptionPlaceholder')}
          maxLength={2000}
          required
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-caption text-foreground-secondary">{t('mitigationLabel')}</Label>
        <Textarea
          value={mitigation}
          onChange={(e) => setMitigation(e.target.value)}
          placeholder={t('mitigationPlaceholder')}
          maxLength={2000}
          rows={2}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label className="text-caption text-foreground-secondary">{t('levelLabel')}</Label>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevel(lvl)}
                aria-pressed={level === lvl}
                className={`flex-1 px-2 py-1 text-caption capitalize ${
                  level === lvl
                    ? 'bg-foreground text-background'
                    : 'bg-background text-foreground-secondary hover:bg-background-secondary'
                }`}
              >
                {t(`levels.${lvl}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-caption text-foreground-secondary">{t('responsibleLabel')}</Label>
          <Input
            type="text"
            value={responsibleParty}
            onChange={(e) => setResponsibleParty(e.target.value)}
            placeholder={t('responsiblePlaceholder')}
            maxLength={255}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-caption text-foreground-secondary">{t('bblArticleLabel')}</Label>
          <Input
            type="text"
            value={bblArticle}
            onChange={(e) => setBblArticle(e.target.value)}
            placeholder={t('bblArticlePlaceholder')}
            maxLength={50}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t('cancelCustom')}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={createMutation.isPending}>
          {t('saveCustom')}
        </Button>
      </div>
    </form>
  );
}
