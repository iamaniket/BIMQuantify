'use client';

import { Box, Columns3, Eraser, Home, LayoutGrid, MousePointer2, Move, Orbit, Settings, Square } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';

import type { ActionMode, NavMode, ViewerHandle } from '@bimstitch/viewer';

import type { ViewerSettings } from '@/lib/viewerSettings';

import { type ToolGroup, UnifiedToolbar } from '@/components/shared/viewer/shared/UnifiedToolbar';
import { SettingsDialog } from '@/components/shared/viewer/shared/settings/SettingsDialog';
import { type ViewMode } from '@/components/shared/viewer/shared/ViewModeSwitcher';
import { CameraFlyPopover } from '@/components/shared/viewer/3d/CameraFlyPopover';

type Props = {
  handle: ViewerHandle | null;
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
  onReloadViewer: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  hasFloorPlans: boolean;
};

export function Toolbar({
  handle,
  settings,
  onSettingsChange,
  onReloadViewer,
  viewMode,
  onViewModeChange,
  hasFloorPlans,
}: Props): JSX.Element {
  const t = useTranslations('viewer.toolbar');
  const tVm = useTranslations('viewer.viewMode');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Two INDEPENDENT axes, both owned by the tool-manager plugin and driven by
  // its `navmode:change` / `action:change` events:
  //   navMode — orbit ↔ first-person (one always active)
  //   action  — select ↔ erase ↔ none (at most one; forced none in first-person)
  const [navMode, setNavMode] = useState<NavMode>('orbit');
  const [action, setAction] = useState<ActionMode>('none');
  const firstPerson = navMode === 'firstPerson';

  useEffect(() => {
    if (!handle) return;
    const offNav = handle.events.on('navmode:change', ({ mode }) => { setNavMode(mode); });
    const offAction = handle.events.on('action:change', ({ action: a }) => { setAction(a); });
    return () => { offNav(); offAction(); };
  }, [handle]);

  const run = (cmd: string, args?: unknown): void => {
    if (!handle) return;
    handle.commands.execute(cmd, args).catch((err: unknown) => {
      console.warn(`[viewer-toolbar] ${cmd} failed:`, err);
    });
  };

  // First-person navigation only applies to the 3D camera — fall back to orbit
  // when the user switches to the pure 2D plan, where the nav group is hidden.
  useEffect(() => {
    if (viewMode === '2d' && firstPerson) run('tool.orbit');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // Navigation axis: Home (one-shot) + Orbit ↔ First-person (mutually exclusive).
  const navGroup: ToolGroup = {
    tools: [
      {
        type: 'button', id: 'home', icon: Home, label: t('homeView'),
        tooltip: `${t('homeView')} (1)`,
        onClick: () => { run('camera.home'); },
      },
      {
        type: 'button',
        id: 'orbit',
        icon: Orbit,
        label: t('orbit'),
        tooltip: `${t('orbit')} (2)`,
        isActive: navMode === 'orbit',
        onClick: () => { run('tool.orbit'); },
      },
      {
        type: 'button',
        id: 'first-person',
        icon: Move,
        label: t('firstPerson'),
        tooltip: `${t('flyTooltip')} (3)`,
        isActive: firstPerson,
        onClick: () => { run('tool.firstPerson'); },
      },
    ],
  };

  // Action axis: Select ↔ Erase ↔ none. Disabled while first-person owns the
  // left button for mouse-look.
  const actionGroup: ToolGroup = {
    tools: [
      {
        type: 'button',
        id: 'select',
        icon: MousePointer2,
        label: t('select'),
        tooltip: `${t('select')} (4)`,
        isActive: action === 'select',
        disabled: firstPerson,
        onClick: () => { run('tool.select'); },
      },
      {
        type: 'button',
        id: 'eraser',
        icon: Eraser,
        label: t('eraser'),
        tooltip: `${t('eraser')} (5)`,
        isActive: action === 'erase',
        disabled: firstPerson,
        onClick: () => { run('tool.erase'); },
      },
    ],
  };

  const viewModeGroup: ToolGroup = {
    tools: [
      {
        type: 'button', id: 'view-3d', icon: Box, label: tVm('model'),
        tooltip: tVm('modelTooltip'), isActive: viewMode === '3d',
        onClick: () => { onViewModeChange('3d'); },
      },
      {
        type: 'button', id: 'view-split', icon: Columns3, label: tVm('split'),
        tooltip: tVm('splitTooltip'), isActive: viewMode === 'split',
        onClick: () => { onViewModeChange('split'); },
      },
      {
        type: 'button', id: 'view-2d', icon: Square, label: tVm('plan'),
        tooltip: tVm('planTooltip'), isActive: viewMode === '2d',
        onClick: () => { onViewModeChange('2d'); },
      },
    ],
  };

  // Display toggles. Spaces (IfcSpace) are hidden by default — this button is
  // the only control for their visibility; active (pressed) means spaces shown.
  const displayGroup: ToolGroup = {
    tools: [
      {
        type: 'button',
        id: 'spaces',
        icon: LayoutGrid,
        label: t('spaces'),
        isActive: settings.spaces.show,
        onClick: () => {
          onSettingsChange({ ...settings, spaces: { show: !settings.spaces.show } });
        },
      },
    ],
  };

  const settingsGroup: ToolGroup = {
    tools: [
      {
        type: 'button', id: 'settings', icon: Settings, label: t('settings'),
        isActive: settingsOpen,
        onClick: () => { setSettingsOpen((v) => !v); },
      },
    ],
  };

  const groups: ToolGroup[] =
    viewMode === '2d'
      ? [...(hasFloorPlans ? [viewModeGroup] : []), settingsGroup]
      : [navGroup, actionGroup, ...(hasFloorPlans ? [viewModeGroup] : []), displayGroup, settingsGroup];

  return (
    <UnifiedToolbar groups={groups} testId="viewer-toolbar" testIdPrefix="viewer">
      {firstPerson ? (
        <CameraFlyPopover handle={handle} onClose={() => { run('tool.orbit'); }} />
      ) : null}
      <SettingsDialog
        mode="3d"
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); }}
        handle={handle}
        settings={settings}
        onSettingsChange={onSettingsChange}
        onReloadViewer={() => {
          setSettingsOpen(false);
          onReloadViewer();
        }}
      />
    </UnifiedToolbar>
  );
}
