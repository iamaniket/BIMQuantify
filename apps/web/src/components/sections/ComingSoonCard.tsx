import type { JSX } from 'react';

import { Badge, Card, CardBody } from '@bimdossier/ui';
import type { AppIcon } from '@bimdossier/ui/icons';

type ComingSoonCardProps = {
  icon: AppIcon;
  title: string;
  body: string;
  /** Pill label, e.g. the localized "Coming soon" / "Binnenkort". */
  badge: string;
};

/**
 * Dimmed, non-clickable "coming soon" card. Shared by the `RoadmapSection`
 * (upcoming features) and, while pre-launch (`LAUNCHED === false`), by the
 * capabilities grid via `FeatureCard`, so both render identically. Pure props —
 * no navigation, no store, no data fetching.
 */
export function ComingSoonCard({ icon: Icon, title, body, badge }: ComingSoonCardProps): JSX.Element {
  return (
    <Card className="h-full opacity-60">
      <CardBody className="gap-4">
        <div className="flex items-start justify-between">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-background-tertiary text-foreground-tertiary">
            <Icon className="h-6 w-6" aria-hidden />
          </div>
          <Badge variant="default" size="sm">
            {badge}
          </Badge>
        </div>
        <div className="space-y-2">
          <h3 className="text-title3 font-semibold text-foreground-tertiary">{title}</h3>
          <p className="text-body2 text-foreground-disabled">{body}</p>
        </div>
      </CardBody>
    </Card>
  );
}
