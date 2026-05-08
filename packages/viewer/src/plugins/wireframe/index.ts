/**
 * Wireframe plugin. Toggles wireframe rendering on all model materials.
 * Hooks into the material list so newly streamed materials also receive
 * the wireframe flag while the mode is active.
 */

import type * as THREE from 'three';
import type { Plugin, ViewerContext } from '../../core/types.js';

const NAME = 'wireframe' as const;

export interface WireframePluginAPI {
  isActive(): boolean;
}

export function wireframePlugin(): Plugin & WireframePluginAPI {
  let ctxRef: ViewerContext | null = null;
  let active = false;
  let materialHookDispose: (() => void) | null = null;

  const setWireframeOnAllMaterials = (wireframe: boolean): void => {
    if (!ctxRef) return;
    for (const model of ctxRef.models().values()) {
      model.object.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          if (mat && 'wireframe' in mat) {
            (mat as THREE.MeshBasicMaterial).wireframe = wireframe;
          }
        }
      });
    }
  };

  const emitChange = (): void => {
    ctxRef?.events.emit('wireframe:change', { active });
  };

  const toggle = (): void => {
    active = !active;
    setWireframeOnAllMaterials(active);
    emitChange();
  };

  const set = (args: unknown): void => {
    const enabled = typeof args === 'boolean'
      ? args
      : (args as { enabled?: boolean })?.enabled ?? !active;
    if (enabled === active) return;
    active = enabled;
    setWireframeOnAllMaterials(active);
    emitChange();
  };

  const api: Plugin & WireframePluginAPI = {
    name: NAME,

    isActive() {
      return active;
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('wireframe.toggle', () => toggle(), {
        title: 'Toggle wireframe mode',
      });

      ctx.commands.register('wireframe.set', (args: unknown) => set(args), {
        title: 'Set wireframe mode',
      });

      ctx.commands.register('wireframe.isActive', () => active, {
        title: 'Get wireframe state',
      });

      // Apply wireframe to materials that stream in while mode is active.
      const handler = ({ value: mat }: { value: THREE.Material }): void => {
        if (active && 'wireframe' in mat) {
          (mat as THREE.MeshBasicMaterial).wireframe = true;
        }
      };
      ctx.fragments.models.materials.list.onItemSet.add(handler);
      materialHookDispose = () => {
        ctx.fragments.models.materials.list.onItemSet.remove(handler);
      };

      // Apply wireframe when new models load while mode is active.
      ctx.events.on('model:loaded', () => {
        if (active) setWireframeOnAllMaterials(true);
      });
    },

    uninstall() {
      if (active && ctxRef) {
        setWireframeOnAllMaterials(false);
      }
      materialHookDispose?.();
      materialHookDispose = null;
      ctxRef = null;
      active = false;
    },
  };

  return api;
}
