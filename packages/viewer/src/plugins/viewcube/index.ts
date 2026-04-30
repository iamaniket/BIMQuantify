/**
 * ViewCube plugin — uses the same `Plugin` interface as the others. The
 * cube is its own canvas overlay (own renderer, own scene), so we don't
 * fight the main render loop. Orientation is slaved to main-camera
 * changes via the `camera:change` event; clicking a region (face / edge
 * / corner) dispatches `camera.view.fromVector` with the region's
 * direction vector.
 */

import * as THREE from 'three';

import type { Plugin, ViewerContext } from '../../core/types.js';
import type { ViewCubeCorner } from '../../types.js';
import { ViewCubeWidget } from './ViewCubeWidget.js';

const NAME = 'viewcube' as const;

interface ViewCubePluginOptions {
  corner?: ViewCubeCorner;
  size?: number;
}

export function viewCubePlugin(options: ViewCubePluginOptions = {}): Plugin {
  let widget: ViewCubeWidget | null = null;
  let unsubCamera: (() => void) | null = null;

  return {
    name: NAME,
    dependencies: ['camera'],

    install(ctx: ViewerContext) {
      widget = new ViewCubeWidget({
        size: options.size ?? 120,
        corner: options.corner ?? 'top-right',
        onPick: (region) => {
          void ctx.commands
            .execute('camera.view.fromVector', {
              direction: {
                x: region.direction.x,
                y: region.direction.y,
                z: region.direction.z,
              },
            })
            .catch(() => undefined);
        },
      });

      ctx.container.appendChild(widget.canvas);

      const sync = (): void => {
        if (!widget) return;
        const target = new THREE.Vector3();
        ctx.cameraControls.getTarget(target);
        widget.syncTo(ctx.camera, target);
      };

      // Initial render + every camera move.
      sync();
      unsubCamera = ctx.events.on('camera:change', sync);
    },

    uninstall() {
      unsubCamera?.();
      unsubCamera = null;
      widget?.dispose();
      widget = null;
    },
  };
}
