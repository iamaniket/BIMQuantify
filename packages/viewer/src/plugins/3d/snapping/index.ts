import * as THREE from 'three';

import type { Plugin, Vec3, ViewerContext } from '../../../core/types.js';
import { pick, type PickResult } from '../../../core/Raycaster.js';
import {
  extractSnapData,
  findBestSnap,
  worldToScreen,
  type ItemSnapData,
  type SnapCandidate,
  type SnapType,
} from './snap-engine.js';
import { SnapIndicator } from './snap-indicator.js';

const NAME = 'snapping' as const;

export type { SnapType, SnapCandidate } from './snap-engine.js';

export interface SnappingPluginOptions {
  enabled?: boolean;
  threshold?: number;
  types?: SnapType[];
}

export interface SnappingPluginAPI {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  resolve(pickResult: PickResult | null): { point: Vec3; snapType: SnapType } | null;
  currentSnap(): SnapCandidate | null;
}

const itemKey = (modelId: string, localId: number): string =>
  `${modelId}::${String(localId)}`;

export function snappingPlugin(
  options?: SnappingPluginOptions,
): Plugin & SnappingPluginAPI {
  let ctx: ViewerContext | null = null;
  let enabled = options?.enabled ?? false;
  let threshold = options?.threshold ?? 15;
  const allowedTypes: SnapType[] = options?.types
    ? [...options.types]
    : ['vertex', 'midpoint', 'edge', 'intersection'];

  const cache = new Map<string, ItemSnapData>();
  let currentResult: SnapCandidate | null = null;
  let lastHitKey: string | null = null;
  const indicator = new SnapIndicator();

  let inFlight = false;
  let pendingNdc: { x: number; y: number } | null = null;

  let moveUnsub: (() => void) | null = null;

  const getModelScale = (): number => {
    if (!ctx) return 10;
    const box = new THREE.Box3();
    for (const model of ctx.models().values()) {
      const mBox = model.box;
      if (mBox && !mBox.isEmpty()) box.union(mBox);
    }
    if (box.isEmpty()) return 10;
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z, 1);
  };

  const emitChange = (): void => {
    if (!ctx) return;
    const snap = currentResult
      ? { point: { x: currentResult.point.x, y: currentResult.point.y, z: currentResult.point.z } as Vec3, type: currentResult.type }
      : null;
    ctx.events.emit('snapping:change', { enabled, snap });
  };

  const processMove = async (ndc: { x: number; y: number }): Promise<void> => {
    if (!ctx) return;

    const result = await pick(ctx, ndc);
    if (result) {
      const key = itemKey(result.item.modelId, result.item.localId);
      let snapData = cache.get(key);
      if (!snapData) {
        snapData = await extractSnapData(result.model, result.item.localId);
        cache.set(key, snapData);
      }

      const hitPoint = new THREE.Vector3(result.point.x, result.point.y, result.point.z);
      const cursorScreen = worldToScreen(hitPoint, ctx.camera, ctx.canvas);

      currentResult = findBestSnap(
        snapData,
        cursorScreen,
        ctx.camera,
        ctx.canvas,
        threshold,
        allowedTypes,
      );
      lastHitKey = key;
    } else {
      currentResult = null;
      lastHitKey = null;
    }

    if (!enabled) return;

    if (currentResult) {
      ctx.scene.userData['__canvas'] = ctx.canvas;
      indicator.show(ctx.scene, currentResult, getModelScale(), ctx.camera);
    } else {
      indicator.hide(ctx.scene);
    }
    emitChange();
  };

  const handleMove = async (e: { ndc: { x: number; y: number } }): Promise<void> => {
    if (!enabled) return;

    if (inFlight) {
      pendingNdc = e.ndc;
      return;
    }

    inFlight = true;
    let ndc: { x: number; y: number } | null = e.ndc;

    while (ndc) {
      pendingNdc = null;
      await processMove(ndc);
      ndc = pendingNdc;
    }

    inFlight = false;
  };

  const setEnabled = (value: boolean): void => {
    if (!ctx) return;
    enabled = value;
    if (!enabled) {
      currentResult = null;
      lastHitKey = null;
      indicator.hide(ctx.scene);
      emitChange();
    }
    ctx.events.emit('feature:enabled', { name: NAME, enabled });
  };

  const api: Plugin & SnappingPluginAPI = {
    name: NAME,

    isEnabled() {
      return enabled;
    },

    setEnabled,

    resolve(pickResult: PickResult | null): { point: Vec3; snapType: SnapType } | null {
      if (!enabled || !currentResult || !pickResult) return null;

      const hitKey = itemKey(pickResult.item.modelId, pickResult.item.localId);
      if (hitKey !== lastHitKey) return null;

      return {
        point: {
          x: currentResult.point.x,
          y: currentResult.point.y,
          z: currentResult.point.z,
        },
        snapType: currentResult.type,
      };
    },

    currentSnap() {
      return currentResult;
    },

    install(context: ViewerContext) {
      ctx = context;

      moveUnsub = ctx.events.on('pointer:move', (e) => void handleMove(e));

      ctx.commands.register(
        'snapping.toggle',
        () => setEnabled(!enabled),
        { title: 'Toggle snapping', defaultShortcut: 'S' },
      );
      ctx.commands.register(
        'snapping.enable',
        () => setEnabled(true),
        { title: 'Enable snapping' },
      );
      ctx.commands.register(
        'snapping.disable',
        () => setEnabled(false),
        { title: 'Disable snapping' },
      );
      ctx.commands.register(
        'snapping.setEnabled',
        (args: unknown) => {
          const v = (args as { enabled?: boolean })?.enabled;
          if (typeof v === 'boolean') setEnabled(v);
        },
        { title: 'Set snapping enabled' },
      );
      ctx.commands.register(
        'snapping.isEnabled',
        () => enabled,
        { title: 'Check snapping state' },
      );
      ctx.commands.register(
        'snapping.getSnap',
        () => currentResult,
        { title: 'Get current snap candidate' },
      );
      ctx.commands.register(
        'snapping.setThreshold',
        (args: unknown) => {
          const px = (args as { px?: number })?.px;
          if (typeof px === 'number' && px > 0) threshold = px;
        },
        { title: 'Set snap threshold' },
      );

      // keyboard-shortcuts seeds defaults at install time, but snapping
      // installs after it — manually bind the shortcut.
      ctx.commands
        .execute('shortcuts.bind', { combo: 'S', command: 'snapping.toggle' })
        .catch(() => undefined);
    },

    uninstall() {
      moveUnsub?.();
      moveUnsub = null;
      if (ctx) indicator.hide(ctx.scene);
      indicator.dispose();
      cache.clear();
      currentResult = null;
      lastHitKey = null;
      ctx = null;
    },
  };

  return api;
}
