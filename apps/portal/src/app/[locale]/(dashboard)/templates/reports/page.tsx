'use client';

import { Award, Pencil, Plus, Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Card, CardBody, Skeleton } from '@bimstitch/ui';

import {
  useDeleteReportTemplate,
  useReportTemplates,
  useSetDefaultReportTemplate,
} from '@/features/reportTemplates/hooks';
import { ReportTemplateBuilderDialog } from '@/features/reportTemplates/ReportTemplateBuilderDialog';
import { REPORT_TEMPLATE_TYPES } from '@/lib/api/schemas/reportTemplates';
import type { ReportTemplate } from '@/lib/api/schemas/reportTemplates';
import { useAuth } from '@/providers/AuthProvider';

export default function ReportTemplatesPage(): JSX.Element {
  const t = useTranslations('reportTemplates');
  const { activeMembership, me } = useAuth();
  const canManage = activeMembership?.is_org_admin === true || me?.user.is_superuser === true;

  const [reportType, setReportType] = useState<string>('dossier');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<ReportTemplate | null>(null);

  const templatesQuery = useReportTemplates(reportType);
  const templates = templatesQuery.data ?? [];
  const deleteMutation = useDeleteReportTemplate(reportType);
  const setDefaultMutation = useSetDefaultReportTemplate(reportType);

  const openCreate = (): void => {
    setEditing(null);
    setBuilderOpen(true);
  };
  const openEdit = (tpl: ReportTemplate): void => {
    setEditing(tpl);
    setBuilderOpen(true);
  };
  const handleDelete = (tpl: ReportTemplate): void => {
    deleteMutation.mutate(tpl.id, {
      onSuccess: () => { toast.success(t('list.removeSuccess', { name: tpl.name })); },
      onError: () => { toast.error(t('list.cannotDeleteDefault')); },
    });
  };
  const handleSetDefault = (tpl: ReportTemplate): void => {
    setDefaultMutation.mutate(tpl.id, {
      onSuccess: () => { toast.success(t('list.setDefaultSuccess', { name: tpl.name })); },
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-h3 font-extrabold text-foreground">{t('panel.reportsTitle')}</h1>
        <p className="text-body3 text-foreground-tertiary">{t('panel.reportsSubtitle')}</p>
      </header>

      {/* Report-type selector */}
      <div className="flex flex-wrap gap-1.5">
        {REPORT_TEMPLATE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => { setReportType(type); }}
            className={
              type === reportType
                ? 'rounded-md border border-primary bg-primary-lighter px-3 py-1.5 font-sans text-body3 font-medium text-primary'
                : 'rounded-md border border-border bg-background px-3 py-1.5 font-sans text-body3 text-foreground-secondary transition-colors hover:bg-background-hover'
            }
          >
            {t(`reportTypes.${type}`)}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="font-sans text-caption text-foreground-tertiary tabular-nums">
          {t('panel.showing', { count: templates.length })}
        </span>
        {canManage ? (
          <Button size="md" onClick={openCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('list.newButton')}
          </Button>
        ) : null}
      </div>

      {templatesQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-10 text-center">
          <div className="text-body3 font-medium text-foreground">{t('list.empty')}</div>
          <p className="mt-1 text-caption text-foreground-tertiary">{t('list.emptyHint')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {templates.map((tpl) => (
            <Card key={tpl.id}>
              <CardBody>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">{tpl.name}</span>
                      {tpl.is_default ? (
                        <Badge variant="success" size="md">{t('list.defaultBadge')}</Badge>
                      ) : null}
                    </div>
                    {tpl.description !== null ? (
                      <p className="mt-0.5 truncate font-sans text-caption text-foreground-tertiary">
                        {tpl.description}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {!tpl.is_default ? (
                        <Button variant="border" size="md" title={t('list.setDefault')} onClick={() => { handleSetDefault(tpl); }}>
                          <Award className="h-3 w-3" />
                        </Button>
                      ) : null}
                      <Button variant="border" size="md" title={t('list.edit')} onClick={() => { openEdit(tpl); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="border" size="md" title={t('list.remove')} onClick={() => { handleDelete(tpl); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {canManage ? (
        <ReportTemplateBuilderDialog
          open={builderOpen}
          onOpenChange={setBuilderOpen}
          reportType={reportType}
          template={editing}
        />
      ) : null}
    </div>
  );
}
