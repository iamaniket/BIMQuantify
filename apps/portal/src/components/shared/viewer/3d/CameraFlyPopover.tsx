'use client';

import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  RotateCcw,
  RotateCw,
  X,
  type AppIcon,
} from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, type JSX } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

type FlyDirection = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down';

type Props = {
  handle: ViewerHandle | null;
  onClose: () => void;
};

/**
 * Fly-out camera D-pad. Mirrors the arrow-key shortcuts: Up/Down walk the
 * camera forward/back, Left/Right turn it in place (all at constant height),
 * and the two elevation buttons raise/lower it. Each button drives the same
 * held-direction set as the keys via `cameraFly.press` / `cameraFly.release`,
 * so press-and-hold moves continuously.
 */
export function CameraFlyPopover({ handle, onClose }: Props): JSX.Element {
  const t = useTranslations('viewer.flyNav');
  const ref = useRef<HTMLDivElement | null>(null);
  /** Directions currently pressed via a pointer, so we can release on unmount. */
  const pressed = useRef<Set<FlyDirection>>(new Set());

  const release = useCallback(
    (dir: FlyDirection): void => {
      if (!pressed.current.has(dir)) return;
      pressed.current.delete(dir);
      handle?.commands.execute('cameraFly.release', { dir }).catch(() => undefined);
    },
    [handle],
  );

  const press = useCallback(
    (dir: FlyDirection): void => {
      if (!handle || pressed.current.has(dir)) return;
      pressed.current.add(dir);
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
    const held = pressedRef.current;
    return () => {
      for (const dir of held) {
        handle?.commands.execute('cameraFly.release', { dir }).catch(() => undefined);
      }
      held.clear();
    };
  }, [handle, pressedRef]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('title')}
      data-testid="viewer-fly-popover"
      className="absolute bottom-12 left-1/2 z-20 -translate-x-1/2 rounded-md border border-border bg-background p-4 shadow-lg"
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-6">
        <h2 className="text-body2 font-medium text-foreground">{t('title')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="inline-flex h-8 w-8 items-center justify-center rounded text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-start gap-5">
        {/* Move + turn D-pad (height locked) */}
        <div className="grid grid-cols-3 grid-rows-3 gap-1">
          <span />
          <FlyButton icon={ArrowUp} label={t('moveForward')} disabled={!handle} onPress={() => press('forward')} onRelease={() => release('forward')} />
          <span />
          <FlyButton icon={RotateCcw} label={t('turnLeft')} disabled={!handle} onPress={() => press('left')} onRelease={() => release('left')} />
          <span />
          <FlyButton icon={RotateCw} label={t('turnRight')} disabled={!handle} onPress={() => press('right')} onRelease={() => release('right')} />
          <span />
          <FlyButton icon={ArrowDown} label={t('moveBack')} disabled={!handle} onPress={() => press('back')} onRelease={() => release('back')} />
          <span />
        </div>

        {/* Elevation (changes height) */}
        <div className="flex flex-col items-center gap-1 border-l border-border pl-4">
          <FlyButton icon={ChevronsUp} label={t('raise')} disabled={!handle} onPress={() => press('up')} onRelease={() => release('up')} />
          <span className="text-caption text-foreground-tertiary">{t('height')}</span>
          <FlyButton icon={ChevronsDown} label={t('lower')} disabled={!handle} onPress={() => press('down')} onRelease={() => release('down')} />
        </div>
      </div>
    </div>
  );
}

type FlyButtonProps = {
  icon: AppIcon;
  label: string;
  disabled: boolean;
  onPress: () => void;
  onRelease: () => void;
};

function FlyButton({ icon: Icon, label, disabled, onPress, onRelease }: FlyButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="inline-flex h-10 w-10 touch-none select-none items-center justify-center rounded text-foreground-secondary hover:bg-background-secondary hover:text-foreground active:scale-95 disabled:cursor-not-allowed disabled:text-foreground/20"
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      onPointerUp={onRelease}
      onPointerLeave={onRelease}
      onPointerCancel={onRelease}
    >
      <Icon className="h-5 w-5" weight="bold" />
    </button>
  );
}
