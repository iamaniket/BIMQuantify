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
 * This is a passive D-pad: it never closes itself on a scene click — fly mode is
 * exited only via the toolbar Orbit/Navigation toggle buttons (which route through
 * the tool-manager) or Esc. So clicks and drags in the scene stay in fly mode.
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

  // Esc is the only key-driven exit; routed through `onClose` (→ tool.orbit).
  // There is deliberately NO click-outside dismissal — a navigation mode must
  // survive clicks/drags in the scene (see the component doc above).
  useEffect(() => {
    const onEsc = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => {
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
      // Anchored above the Move/fly button (its trigger), not centered on the
      // whole bar. The nav pill is always the first group when fly mode is
      // reachable (3D only), so the Move button's center is a stable ~113px from
      // the toolbar's left edge: 1px border + 4px pad + Home 40 + gap 4 + Orbit
      // 40 + gap 4 + half of Move 20. `-translate-x-1/2` then centers the panel
      // over that point.
      className="absolute bottom-16 left-[113px] z-40 flex -translate-x-1/2 flex-col items-center gap-1.5"
    >
      <ToolbarGroup>{ROW_TOP.map(renderButton)}</ToolbarGroup>
      <ToolbarGroup>{ROW_BOTTOM.map(renderButton)}</ToolbarGroup>
    </div>
  );
}
