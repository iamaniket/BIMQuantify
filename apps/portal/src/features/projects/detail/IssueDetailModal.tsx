'use client';

import { MapPin, UserCog, CheckCircle2 } from 'lucide-react';
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
} from '@bimstitch/ui';

import type { ComplianceIssue } from '@/features/compliance/types';
import { issueChipColors } from '@/lib/formatting/disciplineColors';

type Props = {
  issue: ComplianceIssue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function IssueDetailModal({ issue, open, onOpenChange }: Props): JSX.Element {
  if (issue === null) {
    return <Dialog open={false}><DialogContent><span /></DialogContent></Dialog>;
  }

  const colors = issueChipColors(issue.modelDiscipline);

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

      </DialogContent>
    </Dialog>
  );
}
