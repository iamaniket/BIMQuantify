'use client';

import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bimstitch/ui';

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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (requests.length === 0) {
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
          <TableHead className="w-8" />
          <TableHead>{t('name')}</TableHead>
          <TableHead>{t('email')}</TableHead>
          <TableHead>{t('company')}</TableHead>
          <TableHead>{t('role')}</TableHead>
          <TableHead>{t('companySize')}</TableHead>
          <TableHead>{t('country')}</TableHead>
          <TableHead>{t('status')}</TableHead>
          <TableHead>{t('submitted')}</TableHead>
          <TableHead>{t('actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((req) => {
          const isExpanded = expandedId === req.id;
          return (
            <TableRow key={req.id} className="group">
              <TableCell>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded text-foreground-tertiary hover:bg-background-hover"
                  onClick={() => { setExpandedId(isExpanded ? null : req.id); }}
                  aria-label={isExpanded ? t('collapse') : t('expand')}
                >
                  {isExpanded
                    ? <ChevronUp className="h-3.5 w-3.5" />
                    : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              </TableCell>
              <TableCell className="font-medium">{req.name}</TableCell>
              <TableCell className="text-foreground-secondary">{req.work_email}</TableCell>
              <TableCell>{req.company}</TableCell>
              <TableCell className="text-foreground-secondary">{req.role}</TableCell>
              <TableCell className="text-foreground-tertiary">{req.company_size}</TableCell>
              <TableCell className="text-foreground-tertiary">{req.country}</TableCell>
              <TableCell>
                <Badge variant={statusVariant(req.status)}>{req.status}</Badge>
              </TableCell>
              <TableCell className="text-foreground-tertiary">
                {new Date(req.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell>
                {req.status === 'new' && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { onApprove(req); }}
                      aria-label={t('approve')}
                    >
                      <Check className="h-3.5 w-3.5 text-success" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { onReject(req); }}
                      aria-label={t('reject')}
                    >
                      <X className="h-3.5 w-3.5 text-error" />
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
        {expandedId !== null && (() => {
          const req = requests.find((r) => r.id === expandedId);
          if (req === undefined) return null;
          return (
            <TableRow key={`${expandedId}-detail`}>
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
                      {new Date(req.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </TableCell>
            </TableRow>
          );
        })()}
      </TableBody>
    </Table>
  );
}
