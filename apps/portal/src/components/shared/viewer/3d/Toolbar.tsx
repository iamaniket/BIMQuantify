'use client';

import { Blueprint, BoundingBox, Box, Eraser, Eye, Footprints, Home, MousePointer2, Orbit, Settings, SquareSplitHorizontal } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';

import type { ActionMode, DisplayMode, NavMode, ViewerHandle } from '@bimstitch/viewer';

import type { ViewerSettings } from '@/lib/viewerSettings';

import { type ToolGroup, UnifiedToolbar } from '@/components/shared/viewer/shared/UnifiedToolbar';
import { SettingsDialog } from '@/components/shared/viewer/shared/settings/SettingsDialog';
import { type ViewMode } from '@/components/shared/viewer/shared/ViewModeSwitcher';
import { CameraFlyPopover } from '@/components/shared/viewer/3d/CameraFlyPopover';
import { DisplayModePopover } from '@/components/shared/viewer/3d/DisplayModePopover';

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
  const tMode = useTranslations('viewer.displayMode');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  // Live active display mode, mirrored from the viewer's `display:change` event so
  // the toolbar highlight stays correct even when x-ray is toggled via the X
  // shortcut or context menu (the display-mode plugin reflects that back).
  const [displayMode, setDisplayMode] = useState<DisplayMode>('normal');
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
    const offMode = handle.events.on('display:change', ({ mode }) => { setDisplayMode(mode); });
    return () => { offNav(); offAction(); offMode(); };
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
        icon: Footprints,
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
        type: 'button', id: 'view-split', icon: SquareSplitHorizontal, label: tVm('split'),
        tooltip: tVm('splitTooltip'), isActive: viewMode === 'split',
        onClick: () => { onViewModeChange('split'); },
      },
      {
        type: 'button', id: 'view-2d', icon: Blueprint, label: tVm('plan'),
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
        id: 'display-mode',
        icon: Eye,
        label: tMode('label'),
        isActive: modeOpen || displayMode !== 'normal',
        onClick: () => { setModeOpen((v) => !v); },
      },
      {
        type: 'button',
        id: 'spaces',
        icon: BoundingBox,
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
      {modeOpen ? (
        <DisplayModePopover
          handle={handle}
          activeMode={displayMode}
          onSelect={(m) => {
            run('display.set', m);
            // Persist the look only — x-ray is session-only, so store `normal`.
            onSettingsChange({ ...settings, displayMode: { mode: m === 'xray' ? 'normal' : m } });
            setModeOpen(false);
          }}
          onClose={() => { setModeOpen(false); }}
        />
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
