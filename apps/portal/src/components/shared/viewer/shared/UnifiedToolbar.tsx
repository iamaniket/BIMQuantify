'use client';

import type { AppIcon as LucideIcon } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import { Fragment, type JSX, type ReactNode } from 'react';

import { ToolButton, ToolbarGroup, ToolbarShell } from './_toolbarPrimitives';

export type ButtonToolDef = {
  type: 'button';
  id: string;
  icon: LucideIcon;
  /** Accessible name (aria-label). Also used as tooltip unless `tooltip` is set. */
  label: string;
  /** Title attribute — overrides `label` when the tooltip needs more detail. */
  tooltip?: string;
  disabled?: boolean;
  /** Shows "(coming soon)" suffix in the tooltip. Only for unimplemented tools. */
  comingSoon?: boolean;
  isActive?: boolean;
  badge?: ReactNode;
  onClick: () => void;
};

export type NodeToolDef = {
  type: 'node';
  id: string;
  node: ReactNode;
};

export type ToolDef = ButtonToolDef | NodeToolDef;

export type ToolGroup = {
  tools: ToolDef[];
};

type Props = {
  groups: ToolGroup[];
  /** Overlay content rendered alongside the toolbar (e.g. settings dialogs). */
  children?: ReactNode;
  testId?: string;
  /** Prefix for auto-generated button testids: `{prefix}-tool-{id}`. Defaults to "toolbar". */
  testIdPrefix?: string;
  className?: string;
};

export function UnifiedToolbar({
  groups,
  children,
  testId,
  testIdPrefix = 'toolbar',
  className,
}: Props): JSX.Element {
  const t = useTranslations('viewer.toolbar');
  return (
    <ToolbarShell testId={testId} className={className}>
      {children}
      {groups.map((group, gi) => (
        <ToolbarGroup key={gi} withDivider={gi > 0}>
          {group.tools.map((def) => {
            if (def.type === 'node') {
              return <Fragment key={def.id}>{def.node}</Fragment>;
            }
            const title =
              def.disabled && def.comingSoon
                ? t('comingSoonSuffix', { label: def.tooltip ?? def.label })
                : (def.tooltip ?? def.label);
            return (
              <ToolButton
                key={def.id}
                onClick={def.onClick}
                title={title}
                aria-label={def.label}
                disabled={def.disabled}
                isActive={def.isActive ?? false}
                data-testid={`${testIdPrefix}-tool-${def.id}`}
              >
                <def.icon className="h-[22px] w-[22px]" weight="bold" />
                {def.badge}
              </ToolButton>
            );
          })}
        </ToolbarGroup>
      ))}
    </ToolbarShell>
  );
}
