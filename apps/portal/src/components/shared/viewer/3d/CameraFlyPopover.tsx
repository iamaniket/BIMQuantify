'use client';

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  RotateCcw,
  RotateCw,
  type AppIcon,
} from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import { ToolbarGroup, ToolButton } from '@/components/shared/viewer/shared/_toolbarPrimitives';

type FlyDirection =
  | 'forward'
  | 'back'
  | 'turnLeft'
  | 'turnRight'
  | 'strafeLeft'
  | 'strafeRight'
  | 'up'
  | 'down';

type Props = {
  handle: ViewerHandle | null;
  onClose: () => void;
};

type FlyControl = { dir: FlyDirection; icon: AppIcon; labelKey: string };

/**
 * Fly-navigation flyout — styled as an extension of the toolbar (two stacked
 * toolbar pills) whose two rows mirror the physical keyboard:
 *   row 1 → Q W E R  (turn-left, forward, turn-right, up)
 *   row 2 → A S D F  (strafe-left, back, strafe-right, down)
 * Each button drives the same held-direction set as the keys via
 * `cameraFly.press` / `cameraFly.release`, so press-and-hold moves continuously.
 * Closing is the toolbar's Fly button (toggles select) plus Esc / click-outside.
 */
export function CameraFlyPopover({ handle, onClose }: Props): JSX.Element {
  const t = useTranslations('viewer.flyNav');
  const ref = useRef<HTMLDivElement | null>(null);
  /** Directions currently pressed via a pointer, so we can release on unmount. */
  const pressed = useRef<Set<FlyDirection>>(new Set());
  /** Mirror of `pressed` for rendering the held button as active. */
  const [held, setHeld] = useState<ReadonlySet<FlyDirection>>(new Set());

  const release = useCallback(
    (dir: FlyDirection): void => {
      if (!pressed.current.has(dir)) return;
      pressed.current.delete(dir);
      setHeld(new Set(pressed.current));
      handle?.commands.execute('cameraFly.release', { dir }).catch(() => undefined);
    },
    [handle],
  );

  const press = useCallback(
    (dir: FlyDirection): void => {
      if (!handle || pressed.current.has(dir)) return;
      pressed.current.add(dir);
      setHeld(new Set(pressed.current));
      handle.commands.execute('cameraFly.press', { dir }).catch(() => undefined);
    },
    [handle],
  );

  useEffect(() => {
    const onDocClick = (ev: MouseEvent): void => {
      const node = ref.current;
      if (node && !node.contains(ev.target as Node)) onClose();
    };
    const onEsc = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  // Release any held direction if the popover unmounts mid-press.
  const pressedRef = pressed;
  useEffect(() => {
    const heldDirs = pressedRef.current;
    return () => {
      for (const dir of heldDirs) {
        handle?.commands.execute('cameraFly.release', { dir }).catch(() => undefined);
      }
      heldDirs.clear();
    };
  }, [handle, pressedRef]);

  const ROW_TOP: FlyControl[] = [
    { dir: 'turnLeft', icon: RotateCcw, labelKey: 'turnLeft' },
    { dir: 'forward', icon: ArrowUp, labelKey: 'moveForward' },
    { dir: 'turnRight', icon: RotateCw, labelKey: 'turnRight' },
    { dir: 'up', icon: ChevronsUp, labelKey: 'raise' },
  ];
  const ROW_BOTTOM: FlyControl[] = [
    { dir: 'strafeLeft', icon: ArrowLeft, labelKey: 'strafeLeft' },
    { dir: 'back', icon: ArrowDown, labelKey: 'moveBack' },
    { dir: 'strafeRight', icon: ArrowRight, labelKey: 'strafeRight' },
    { dir: 'down', icon: ChevronsDown, labelKey: 'lower' },
  ];

  const renderButton = ({ dir, icon: Icon, labelKey }: FlyControl): JSX.Element => {
    const label = t(labelKey);
    return (
      <ToolButton
        key={dir}
        aria-label={label}
        title={label}
        disabled={!handle}
        isActive={held.has(dir)}
        data-testid={`viewer-fly-${dir}`}
        className="touch-none select-none"
        onPointerDown={(e) => {
          e.preventDefault();
          press(dir);
        }}
        onPointerUp={() => { release(dir); }}
        onPointerLeave={() => { release(dir); }}
        onPointerCancel={() => { release(dir); }}
      >
        <Icon className="h-[22px] w-[22px]" weight="bold" />
      </ToolButton>
    );
  };

  return (
    <div
      ref={ref}
      role="group"
      aria-label={t('title')}
      data-testid="viewer-fly-popover"
      className="absolute bottom-16 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-1.5"
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      <ToolbarGroup>{ROW_TOP.map(renderButton)}</ToolbarGroup>
      <ToolbarGroup>{ROW_BOTTOM.map(renderButton)}</ToolbarGroup>
    </div>
  );
}
