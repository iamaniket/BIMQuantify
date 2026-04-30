/**
 * ViewCube plugin — wires the nav-cube widget to the viewer's command bus.
 * The widget itself never touches `cameraControls`; everything goes through
 * `camera.*` commands so the camera plugin remains the single owner of
 * camera state.
 */

import * as THREE from 'three';

import type { Plugin, ViewerContext } from '../../core/types.js';
import type { ViewCubeCorner } from '../../types.js';
import { ViewCubeWidget } from './ViewCubeWidget.js';

const NAME = 'viewcube' as const;

interface ViewCubePluginOptions {
  corner?: ViewCubeCorner;
  size?: number;
  showCompass?: boolean;
  showSnapArrows?: boolean;
  showHomeButton?: boolean;
}

export function viewCubePlugin(options: ViewCubePluginOptions = {}): Plugin {
  let widget: ViewCubeWidget | null = null;
  let unsubCamera: (() => void) | null = null;

  return {
    name: NAME,
    dependencies: ['camera'],

    install(ctx: ViewerContext) {
      widget = new ViewCubeWidget({
        size: options.size ?? 160,
        corner: options.corner ?? 'top-right',
        showCompass: options.showCompass ?? true,
        showSnapArrows: options.showSnapArrows ?? true,
        showHomeButton: options.showHomeButton ?? true,
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
        onOrbit: (deltaAzimuth, deltaPolar) => {
          void ctx.commands
            .execute('camera.orbit.delta', { deltaAzimuth, deltaPolar })
            .catch(() => undefined);
        },
        onSnapRotate: (dir) => {
          void ctx.commands
            .execute('camera.orbit.delta', {
              deltaAzimuth: dir * (Math.PI / 2),
              deltaPolar: 0,
              animate: true,
            })
            .catch(() => undefined);
        },
        onHome: () => {
          void ctx.commands.execute('camera.home').catch(() => undefined);
        },
      });

      ctx.container.appendChild(widget.element);

      const sync = (): void => {
        if (!widget) return;
        const target = new THREE.Vector3();
        ctx.cameraControls.getTarget(target);
        widget.syncTo(ctx.camera, target);
      };

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
