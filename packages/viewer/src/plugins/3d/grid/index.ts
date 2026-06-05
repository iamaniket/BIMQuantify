import * as THREE from 'three';

import type { Plugin, ViewerContext } from '../../../core/types.js';

const NAME = 'grid' as const;

export interface GridPluginOptions {
  size?: number;
  divisions?: number;
  centerColor?: number;
  lineColor?: number;
  opacity?: number;
  autoSize?: boolean;
}

export interface GridPluginAPI {
  isVisible(): boolean;
  toggle(): void;
  setConfig(cfg: Partial<GridPluginOptions>): void;
}

export function gridPlugin(options: GridPluginOptions = {}): Plugin & GridPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let gridHelper: THREE.GridHelper | null = null;
  let visible = false;

  const config = {
    size: options.size ?? 100,
    divisions: options.divisions ?? 50,
    centerColor: options.centerColor ?? 0x444444,
    lineColor: options.lineColor ?? 0xcccccc,
    opacity: options.opacity ?? 0.4,
    autoSize: options.autoSize ?? true,
  };

  const createGrid = (): void => {
    if (!ctxRef) return;
    removeGrid();

    let size = config.size;
    if (config.autoSize) {
      const box = new THREE.Box3();
      for (const model of ctxRef.models().values()) {
        const mBox = model.box;
        if (mBox && !mBox.isEmpty()) box.union(mBox);
      }
      if (!box.isEmpty()) {
        const s = box.getSize(new THREE.Vector3());
        size = Math.max(s.x, s.z) * 3;
      }
    }

    gridHelper = new THREE.GridHelper(
      size,
      config.divisions,
      new THREE.Color(config.centerColor),
      new THREE.Color(config.lineColor),
    );
    const mat = gridHelper.material as THREE.Material;
    mat.transparent = true;
    mat.opacity = config.opacity;
    mat.depthWrite = false;
    gridHelper.renderOrder = -2;

    if (config.autoSize && ctxRef.models().size > 0) {
      const box = new THREE.Box3();
      for (const model of ctxRef.models().values()) {
        const mBox = model.box;
        if (mBox && !mBox.isEmpty()) box.union(mBox);
      }
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3());
        gridHelper.position.set(center.x, box.min.y - 0.01, center.z);
      }
    }

    ctxRef.scene.add(gridHelper);
  };

  const removeGrid = (): void => {
    if (gridHelper) {
      gridHelper.removeFromParent();
      gridHelper.geometry.dispose();
      const mat = gridHelper.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else (mat as THREE.Material).dispose();
      gridHelper = null;
    }
  };

  const api: Plugin & GridPluginAPI = {
    name: NAME,

    isVisible() {
      return visible;
    },

    toggle() {
      visible = !visible;
      if (visible) {
        createGrid();
      } else {
        removeGrid();
      }
      ctxRef?.events.emit('grid:change', { visible });
    },

    setConfig(cfg) {
      Object.assign(config, cfg);
      if (visible) createGrid();
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('grid.toggle', () => api.toggle(), {
        title: 'Toggle grid',
      });

      ctx.commands.register('grid.setConfig', (args: unknown) => {
        if (args && typeof args === 'object') {
          api.setConfig(args as Partial<GridPluginOptions>);
        }
      }, { title: 'Configure grid' });

      ctx.commands.register('grid.isVisible', () => visible, {
        title: 'Check grid visibility',
      });
    },

    uninstall() {
      removeGrid();
      visible = false;
      ctxRef = null;
    },
  };

  return api;
}
