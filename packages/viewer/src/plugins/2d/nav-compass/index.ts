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
}

export function navCompassPlugin(options: NavCompassPluginOptions = {}): DocumentPlugin {
  let widget: NavCompassWidget | null = null;
  let unsubRotation: (() => void) | null = null;

  return {
    name: NAME,
    dependencies: ['rotate'],

    install(ctx: DocumentContext): void {
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
