'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@bimstitch/ui';

import type { AuditEntry } from '@/lib/api/schemas';

type Props = { entries: AuditEntry[] };

function summarize(entry: AuditEntry): string {
  const before = entry.before === null ? null : JSON.stringify(entry.before);
  const after = entry.after === null ? null : JSON.stringify(entry.after);
  if (before !== null && after !== null) return `${before} → ${after}`;
  if (after !== null) return after;
  if (before !== null) return before;
  return '';
}

export function AuditLogTable({ entries }: Props): JSX.Element {
  const t = useTranslations('admin.audit.table');

  if (entries.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-body3 text-foreground-tertiary">
        {t('empty')}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('when')}</TableHead>
          <TableHead>{t('action')}</TableHead>
          <TableHead>{t('resource')}</TableHead>
          <TableHead>{t('change')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="whitespace-nowrap font-mono text-caption text-foreground-tertiary">
              {new Date(entry.created_at).toLocaleString()}
            </TableCell>
            <TableCell className="font-mono">{entry.action}</TableCell>
            <TableCell className="font-mono text-foreground-tertiary">
              {entry.resource_type}
              {entry.resource_id !== null && (
                <span className="block text-caption">{entry.resource_id}</span>
              )}
            </TableCell>
            <TableCell className="max-w-[480px] truncate font-mono text-caption text-foreground-tertiary">
              {summarize(entry)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
