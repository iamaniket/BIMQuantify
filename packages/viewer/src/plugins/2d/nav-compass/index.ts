/**
 * Nav-compass plugin — wires the orientation dial to the document command bus.
 * The 2D counterpart to the 3D `viewcube` plugin: the widget never touches engine
 * state directly; rotation goes through the existing `rotate.to` command so the
 * `rotate` plugin stays the single owner of page rotation.
 */

import type { DocumentContext, DocumentPlugin } from '../../../pdf-core/documentTypes.js';
import { NavCompassWidget, type NavCompassLocale } from './NavCompassWidget.js';

const NAME = 'nav-compass' as const;

interface NavCompassPluginOptions {
  size?: number;
  locale?: NavCompassLocale;
  /**
   * Static true-north mode (degrees clockwise from up). When set, the dial is a
   * non-interactive true-north indicator — it shows the building's north rather
   * than page rotation, and the plugin has no `rotate` dependency. Used by the
   * floor plan (which never rotates). When omitted, the dial is the interactive
   * PDF page-rotation control as before.
   */
  northDeg?: number;
}

export function navCompassPlugin(options: NavCompassPluginOptions = {}): DocumentPlugin {
  let widget: NavCompassWidget | null = null;
  let unsubRotation: (() => void) | null = null;
  const isStatic = options.northDeg !== undefined;

  return {
    name: NAME,
    // A static north dial drives no rotation, so it doesn't need the rotate plugin
    // (which the floor plan never mounts). The PDF dial still owns rotate.to.
    dependencies: isStatic ? [] : ['rotate'],

    install(ctx: DocumentContext): void {
      if (options.northDeg !== undefined) {
        widget = new NavCompassWidget({
          size: options.size ?? 140,
          locale: options.locale ?? 'nl',
          northDeg: options.northDeg,
        });
        ctx.viewportOverlay.appendChild(widget.element);
        return;
      }

      widget = new NavCompassWidget({
        size: options.size ?? 140,
        locale: options.locale ?? 'nl',
        onRotateTo: (rotation) => {
          void ctx.commands.execute('rotate.to', { rotation }).catch(() => undefined);
        },
        onHome: () => {
          void ctx.commands.execute('rotate.to', { rotation: 0 }).catch(() => undefined);
        },
      });

      ctx.viewportOverlay.appendChild(widget.element);
      widget.syncTo(ctx.getRotation());

      unsubRotation = ctx.events.on('rotation:change', ({ rotation }) => {
        widget?.syncTo(rotation);
      });
    },

    uninstall(): void {
      unsubRotation?.();
      unsubRotation = null;
      widget?.dispose();
      widget = null;
    },
  };
}

export type { NavCompassLocale };
