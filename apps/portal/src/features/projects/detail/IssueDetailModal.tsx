'use client';

import { MapPin, UserCog, CheckCircle2, X } from 'lucide-react';
import type { JSX } from 'react';

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@bimstitch/ui';

import type { ComplianceIssue } from '@/features/projects/compliance/types';

type Props = {
  issue: ComplianceIssue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DISC_COLORS: Record<string, { bg: string; fg: string }> = {
  FIRE: { bg: '#fde2e2', fg: '#b91c1c' },
  ARCH: { bg: '#ede8f7', fg: '#5a3fa6' },
  STR: { bg: '#e5edf7', fg: '#2c5697' },
  MEP: { bg: '#f8ecd9', fg: '#a97428' },
  ACC: { bg: '#eaf6ef', fg: '#3f8f65' },
  ENV: { bg: '#e0f2fe', fg: '#0369a1' },
};

export function IssueDetailModal({ issue, open, onOpenChange }: Props): JSX.Element {
  if (issue === null) {
    return <Dialog open={false}><DialogContent><span /></DialogContent></Dialog>;
  }

  const colors = DISC_COLORS[issue.modelDiscipline] ?? { bg: '#f1f3f6', fg: '#4b5563' };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant={issue.severity === 'fail' ? 'error' : 'warning'}>
              {issue.severity.toUpperCase()}
            </Badge>
            <span className="font-mono text-body3 font-bold text-foreground-tertiary">
              {issue.id}
            </span>
          </div>
          <DialogTitle className="mt-1">
            <span className="font-mono text-primary">{issue.bblCode}</span>
            {' · '}
            {issue.objectName}
          </DialogTitle>
        </DialogHeader>

        <DialogBody>
          <div className="grid grid-cols-2 gap-3 text-body3">
            <div>
              <span className="text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
                Location
              </span>
              <div className="mt-0.5 font-medium text-foreground">{issue.location}</div>
            </div>
            <div>
              <span className="text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
                Model
              </span>
              <div className="mt-0.5">
                <span
                  className="rounded-sm px-1 py-px text-[9.5px] font-bold"
                  style={{ background: colors.bg, color: colors.fg }}
                >
                  {issue.modelDiscipline}
                </span>
              </div>
            </div>
            <div>
              <span className="text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
                Owner
              </span>
              <div className="mt-0.5 font-medium text-foreground">{issue.owner}</div>
            </div>
            <div>
              <span className="text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
                Created
              </span>
              <div className="mt-0.5 font-medium text-foreground">{issue.createdAt} ago</div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-background-secondary p-3">
            <span className="text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
              Bbl requirement
            </span>
            <p className="mt-1 text-body3 leading-relaxed text-foreground">
              {issue.requirementText}
            </p>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="border" size="sm">
            <MapPin className="mr-1.5 h-3 w-3" />
            Pin photo
          </Button>
          <Button variant="border" size="sm">
            <UserCog className="mr-1.5 h-3 w-3" />
            Reassign
          </Button>
          <Button variant="primary" size="sm">
            <CheckCircle2 className="mr-1.5 h-3 w-3" />
            Mark resolved
          </Button>
        </DialogFooter>

        <DialogClose asChild>
          <button
            type="button"
            className="absolute right-3 top-3 rounded-md p-1 text-foreground-tertiary transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
