'use client';

import { CheckCircle, Pencil, Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import { PageTable, type Column } from '@/components/shared/PageTable';
import type { FindingTemplate } from '@/lib/api/schemas';

type Props = {
  templates: FindingTemplate[];
  canManage: boolean;
  onEdit: (template: FindingTemplate) => void;
  onSetDefault: (template: FindingTemplate) => void;
  onDelete: (template: FindingTemplate) => void;
};

const ACTION_BTN =
  'inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export function FindingTemplatesTable({
  templates,
  canManage,
  onEdit,
  onSetDefault,
  onDelete,
}: Props): JSX.Element {
  const t = useTranslations('findingTemplates');

  const columns: Column<FindingTemplate>[] = [
    {
      header: t('table.name'),
      cell: (tpl) => (
        <>
          <span className="font-medium text-foreground">{tpl.name}</span>
          {tpl.description !== null && tpl.description !== '' && (
            <div className="font-sans text-caption text-foreground-tertiary">{tpl.description}</div>
          )}
        </>
      ),
    },
    {
      header: t('table.default'),
      cell: (tpl) =>
        tpl.is_default ? (
          <Badge variant="success" size="md" bordered>
            <CheckCircle className="mr-1 h-3 w-3" />
            {t('list.defaultBadge')}
          </Badge>
        ) : (
          <span className="text-foreground-tertiary">—</span>
        ),
    },
    {
      header: t('table.fields'),
      className: 'text-foreground-secondary tabular-nums',
      cell: (tpl) => String(tpl.fields.length),
    },
    {
      header: t('table.updated'),
      className: 'text-foreground-secondary tabular-nums',
      cell: (tpl) => formatDate(tpl.updated_at),
    },
    {
      header: '',
      cell: (tpl) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            {!tpl.is_default && (
              <button
                type="button"
                title={t('list.setDefault')}
                onClick={() => { onSetDefault(tpl); }}
                className={ACTION_BTN}
              >
                <CheckCircle className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              title={t('list.edit')}
              onClick={() => { onEdit(tpl); }}
              className={ACTION_BTN}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={t('list.remove')}
              onClick={() => { onDelete(tpl); }}
              className={`${ACTION_BTN} hover:text-error`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <span className="text-foreground-tertiary">—</span>
        ),
    },
  ];

  return (
    <PageTable
      columns={columns}
      data={templates}
      rowKey={(tpl) => tpl.id}
      emptyMessage={t('list.emptyTitle')}
    />
  );
}
