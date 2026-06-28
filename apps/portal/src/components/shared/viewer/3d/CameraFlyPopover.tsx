'use client';

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  type AppIcon,
} from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import type { ViewerHandle } from '@bimdossier/viewer';

import { ToolbarGroup, ToolButton } from '@/components/shared/viewer/shared/_toolbarPrimitives';
import { DEFAULT_CAMERA_FLY } from '@/lib/viewerSettings';

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
 * Render the live move speed as a multiplier relative to the factory default
 * (so the default speed reads `1.0×`, and the ± steps land on `1.3×`, `1.6×`, …).
 * Compact to ≤4 chars: one decimal under 10×, integer at/above.
 */
function formatSpeed(moveFraction: number): string {
  const m = moveFraction / DEFAULT_CAMERA_FLY.moveFraction;
  return `${m >= 9.95 ? Math.round(m) : m.toFixed(1)}×`;
}

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
  /** Live move speed (fraction of scene diagonal/sec); seeded to the default so
   *  the readout shows `1.0×` immediately, then corrected from the plugin. */
  const [moveFraction, setMoveFraction] = useState<number>(DEFAULT_CAMERA_FLY.moveFraction);

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

  // Track the live move speed: seed from the plugin on open (the `fly:speed`
  // event only fires on change), then follow every change — buttons, the = / -
  // keys, and the Settings slider all funnel through it.
  useEffect(() => {
    if (!handle) return;
    let alive = true;
    handle.commands
      .execute<number>('cameraFly.getSpeed')
      .then((v) => { if (alive && typeof v === 'number') setMoveFraction(v); })
      .catch(() => undefined);
    const off = handle.events.on('fly:speed', ({ moveFraction: m }) => { setMoveFraction(m); });
    return () => {
      alive = false;
      off();
    };
  }, [handle]);

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
      {/* Move-speed adjust. The wheel already dollies forward/back in fly mode, so
          speed lives here (and on the = / - keys), not on the wheel. Pinned to the
          right edge of the directional block and stretched to its full height so +
          aligns to the top row and − to the bottom; the live multiplier sits between
          them. Absolute so it adds no width to the centered directional block. */}
      <ToolbarGroup className="absolute inset-y-0 left-full ml-1.5 flex-col justify-between">
        <ToolButton
          aria-label={t('faster')}
          title={t('faster')}
          disabled={!handle}
          data-testid="viewer-fly-faster"
          onClick={() => { handle?.commands.execute('cameraFly.speedUp').catch(() => undefined); }}
        >
          <Plus className="h-[22px] w-[22px]" weight="bold" />
        </ToolButton>
        <span
          aria-label={t('speed')}
          title={t('speed')}
          data-testid="viewer-fly-speed"
          className="w-10 select-none text-center font-sans text-caption leading-none tabular-nums text-foreground-secondary"
        >
          {formatSpeed(moveFraction)}
        </span>
        <ToolButton
          aria-label={t('slower')}
          title={t('slower')}
          disabled={!handle}
          data-testid="viewer-fly-slower"
          onClick={() => { handle?.commands.execute('cameraFly.speedDown').catch(() => undefined); }}
        >
          <Minus className="h-[22px] w-[22px]" weight="bold" />
        </ToolButton>
      </ToolbarGroup>
    </div>
  );
}
