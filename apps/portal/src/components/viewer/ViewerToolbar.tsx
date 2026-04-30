'use client';

import {
  Home,
  MousePointer2,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useState, type JSX } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import type { ViewerSettings } from '@/lib/viewerSettings';

import { ViewerSettingsPopover } from './ViewerSettingsPopover';

type Props = {
  handle: ViewerHandle | null;
  selectionCount: number;
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
  onReloadViewer: () => void;
};

type IconButtonProps = {
  icon: LucideIcon;
  label: string;
  testId: string;
  onClick: () => void;
  active: boolean | undefined;
  badge: number | undefined;
};

function IconButton({
  icon: Icon,
  label,
  testId,
  onClick,
  active,
  badge,
}: IconButtonProps): JSX.Element {
  const isActive = active === true;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={testId}
      data-active={isActive ? 'true' : undefined}
      className={
        'relative inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors '
        + 'text-foreground-secondary hover:bg-background-secondary hover:text-foreground '
        + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '
        + 'data-[active=true]:bg-background-secondary data-[active=true]:text-foreground'
      }
    >
      <Icon className="h-4 w-4" />
      {badge !== undefined ? (
        <span
          data-testid="viewer-selection-badge"
          className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-4 text-primary-foreground"
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Bottom-anchored, icon-only toolbar. Orbit/pan/zoom and view presets are
 * already handled inside the viewer (camera plugin + ViewCube), so the
 * portal-side toolbar only owns: Home (reset camera), Selection (clear),
 * and Settings (popover).
 */
export function ViewerToolbar({
  handle,
  selectionCount,
  settings,
  onSettingsChange,
  onReloadViewer,
}: Props): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const run = (cmd: string): void => {
    if (!handle) return;
    handle.commands.execute(cmd).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[viewer-toolbar] ${cmd} failed:`, err);
    });
  };

  return (
    <div
      className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2"
      data-testid="viewer-toolbar"
    >
      {settingsOpen ? (
        <ViewerSettingsPopover
          handle={handle}
          settings={settings}
          onSettingsChange={onSettingsChange}
          onClose={() => {
            setSettingsOpen(false);
          }}
          onReloadViewer={() => {
            setSettingsOpen(false);
            onReloadViewer();
          }}
        />
      ) : null}

      <div className="flex items-center gap-1 rounded-full border border-border bg-background/95 px-1.5 py-1 shadow-md backdrop-blur">
        <IconButton
          icon={Home}
          label="Home view"
          testId="viewer-cmd-camera.view.iso"
          active={undefined}
          badge={undefined}
          onClick={() => {
            run('camera.view.iso');
          }}
        />
        <IconButton
          icon={MousePointer2}
          label="Select (click to clear)"
          active
          badge={selectionCount > 0 ? selectionCount : undefined}
          testId="viewer-cmd-selection.clear"
          onClick={() => {
            run('selection.clear');
          }}
        />
        <IconButton
          icon={Settings}
          label="Settings"
          active={settingsOpen}
          badge={undefined}
          testId="viewer-cmd-settings"
          onClick={() => {
            setSettingsOpen((v) => !v);
          }}
        />
      </div>
    </div>
  );
}
