'use client';

import { Upload, ScanLine, MapPin, Wrench, FileText } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import type { ActivityItem } from '@/features/projects/compliance/types';

type Props = {
  activity: ActivityItem[];
};

const TYPE_ICONS: Record<ActivityItem['type'], ReactNode> = {
  upload: <Upload className="h-3.5 w-3.5" />,
  scan: <ScanLine className="h-3.5 w-3.5" />,
  pin: <MapPin className="h-3.5 w-3.5" />,
  fix: <Wrench className="h-3.5 w-3.5" />,
  report: <FileText className="h-3.5 w-3.5" />,
};

const TYPE_COLORS: Record<ActivityItem['type'], string> = {
  upload: 'bg-primary/10 text-primary',
  scan: 'bg-success-lighter text-success',
  pin: 'bg-warning-lighter text-warning',
  fix: 'bg-error-lighter text-error',
  report: 'bg-info-lighter text-info',
};

export function ActivityTab({ activity }: Props): JSX.Element {
  if (activity.length === 0) {
    return (
      <div className="py-8 text-center text-body3 text-foreground-tertiary">
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {activity.map((item, i) => (
        <div
          key={item.id}
          className={`flex items-start gap-3 px-1 py-3 ${
            i < activity.length - 1 ? 'border-b border-dashed border-border' : ''
          }`}
        >
          <div
            className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md ${TYPE_COLORS[item.type]}`}
          >
            {TYPE_ICONS[item.type]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between">
              <span className="text-body3">
                <span className="font-semibold text-foreground">{item.actor}</span>
                <span className="ml-1 text-foreground-secondary">{item.description}</span>
              </span>
              <span className="shrink-0 text-caption text-foreground-tertiary">
                {item.timestamp} ago
              </span>
            </div>
            <div className="mt-0.5 text-caption text-foreground-tertiary">{item.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
