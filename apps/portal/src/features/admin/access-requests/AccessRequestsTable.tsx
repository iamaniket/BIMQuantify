'use client';

import { Check, ChevronDown, ChevronUp, X } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Badge, Button, TableCell, TableRow } from '@bimstitch/ui';
import type { Locale } from '@bimstitch/i18n';

import { PageTable, type Column } from '@/components/shared/PageTable';
import { formatDate, formatDateTime } from '@/lib/formatting/dates';
import type { AccessRequestRead } from '@/lib/api/schemas';

type Props = {
  requests: AccessRequestRead[];
  onApprove: (request: AccessRequestRead) => void;
  onReject: (request: AccessRequestRead) => void;
};

function statusVariant(s: string): 'default' | 'success' | 'error' {
  if (s === 'approved') return 'success';
  if (s === 'rejected') return 'error';
  return 'default';
}

export function AccessRequestsTable({ requests, onApprove, onReject }: Props): JSX.Element {
  const t = useTranslations('admin.accessRequests.table');
  const locale = useLocale() as Locale;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const columns: Column<AccessRequestRead>[] = [
    {
      header: '',
      headerClassName: 'w-8',
      cell: (req) => {
        const isExpanded = expandedId === req.id;
        return (
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-foreground-tertiary hover:bg-background-hover"
            onClick={() => { setExpandedId(isExpanded ? null : req.id); }}
            aria-label={isExpanded ? t('collapse') : t('expand')}
          >
            {isExpanded
              ? <ChevronUp className="h-4 w-4" />
              : <ChevronDown className="h-4 w-4" />}
          </button>
        );
      },
    },
    { header: t('name'), className: 'font-medium', cell: (req) => req.name },
    { header: t('email'), className: 'text-foreground-secondary', cell: (req) => req.work_email },
    { header: t('company'), cell: (req) => req.company },
    { header: t('role'), className: 'text-foreground-secondary', cell: (req) => req.role },
    { header: t('companySize'), className: 'text-foreground-tertiary', cell: (req) => req.company_size },
    { header: t('country'), className: 'text-foreground-tertiary', cell: (req) => req.country },
    {
      header: t('status'),
      cell: (req) => <Badge variant={statusVariant(req.status)}>{req.status}</Badge>,
    },
    {
      header: t('submitted'),
      className: 'text-foreground-tertiary',
      cell: (req) => formatDate(req.created_at, locale),
    },
    {
      header: t('actions'),
      cell: (req) =>
        req.status === 'new' ? (
          <div className="flex gap-1">
            <Button size="md" variant="ghost" onClick={() => { onApprove(req); }} aria-label={t('approve')}>
              <Check className="h-4 w-4 text-success" />
            </Button>
            <Button size="md" variant="ghost" onClick={() => { onReject(req); }} aria-label={t('reject')}>
              <X className="h-4 w-4 text-error" />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <PageTable
      columns={columns}
      data={requests}
      rowKey={(r) => r.id}
      emptyMessage={t('empty')}
      rowClassName="group"
      renderAfterRow={(req) =>
        expandedId === req.id ? (
          <TableRow>
            <TableCell colSpan={10} className="bg-surface-low px-8 py-4">
              <div className="grid grid-cols-2 gap-4 text-body3">
                <div>
                  <span className="font-medium text-foreground-tertiary">{t('notes')}</span>
                  <p className="mt-1 text-foreground-secondary">
                    {req.notes !== null && req.notes.length > 0 ? req.notes : t('noNotes')}
                  </p>
                </div>
                <div>
                  <span className="font-medium text-foreground-tertiary">{t('submittedFull')}</span>
                  <p className="mt-1 text-foreground-secondary">
                    {formatDateTime(req.created_at, locale)}
                  </p>
                </div>
              </div>
            </TableCell>
          </TableRow>
        ) : null
      }
    />
  );
}
