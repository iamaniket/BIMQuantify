'use client';

import { CheckCircle, Pencil, Trash2 } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge } from '@bimstitch/ui';
import type { Locale } from '@bimstitch/i18n';

import { PageTable, type Column } from '@/components/shared/PageTable';
import { formatDate } from '@/lib/formatting/dates';

import type { UnifiedTemplateRow } from './useAllTemplates';

type Props = {
  templates: UnifiedTemplateRow[];
  canManage: boolean;
  onEdit: (row: UnifiedTemplateRow) => void;
  onSetDefault: (row: UnifiedTemplateRow) => void;
  onDelete: (row: UnifiedTemplateRow) => void;
};

const ACTION_BTN =
  'inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground';

export function OrgTemplatesTable({
  templates,
  canManage,
  onEdit,
  onSetDefault,
  onDelete,
}: Props): JSX.Element {
  const t = useTranslations('orgTemplates');
  const locale = useLocale() as Locale;

  const columns: Column<UnifiedTemplateRow>[] = [
    {
      header: t('table.name'),
      cell: (row) => (
        <>
          <span className="font-medium text-foreground">{row.data.name}</span>
          {row.data.description !== null && row.data.description !== '' && (
            <div className="font-sans text-caption text-foreground-tertiary">
              {row.data.description}
            </div>
          )}
        </>
      ),
    },
    {
      header: t('table.type'),
      cell: (row) => (
        <span className="font-sans text-body3 text-foreground-secondary">
          {t(`typeLabel.${row.data.template_type}` as Parameters<typeof t>[0])}
        </span>
      ),
    },
    {
      header: t('table.default'),
      cell: (row) =>
        row.data.is_default ? (
          <Badge variant="success" size="md" bordered>
            <CheckCircle className="mr-1 h-3 w-3" />
            {t('table.defaultBadge')}
          </Badge>
        ) : (
          <span className="text-foreground-tertiary">&mdash;</span>
        ),
    },
    {
      header: t('table.updated'),
      className: 'text-foreground-secondary tabular-nums',
      cell: (row) => formatDate(row.data.updated_at, locale),
    },
    {
      header: '',
      cell: (row) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            {!row.data.is_default && (
              <button
                type="button"
                title={t('actions.setDefault')}
                onClick={() => { onSetDefault(row); }}
                className={ACTION_BTN}
              >
                <CheckCircle className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              title={t('actions.edit')}
              onClick={() => { onEdit(row); }}
              className={ACTION_BTN}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={t('actions.remove')}
              onClick={() => { onDelete(row); }}
              className={`${ACTION_BTN} hover:text-error`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <span className="text-foreground-tertiary">&mdash;</span>
        ),
    },
  ];

  return (
    <PageTable
      columns={columns}
      data={templates}
      rowKey={(row) => row.data.id}
      emptyMessage={t('table.empty')}
    />
  );
}
