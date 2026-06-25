/**
 * `document-pick` — binds the `document.pick` command (wired to left-click by the
 * DocumentViewer's mouse bindings when `linkPicks` is on) to emit `document:pick`
 * with a normalized page point. The PDF counterpart to the floor-plan plugin's
 * `floorplan.pick`, minus the room/spaceId resolution (a PDF has no vector
 * rooms). Used for aligned-sheet click-to-fly: the host projects the page point
 * back to a 3D world point (via the active sheet transform) and flies the camera.
 */

import type { DocumentContext, DocumentPlugin } from '../../../pdf-core/documentTypes.js';
import type { SceneAPI } from '../scene/index.js';
import { screenToPagePoint } from '../shared/screenToPage.js';

declare module '../../../pdf-core/documentTypes.js' {
  interface DocumentEvents {
    /** Left-click on a page resolved to a normalized page point (0..1, top-left). */
    'document:pick': { x: number; y: number; page: number };
  }
}

const NAME = 'document-pick' as const;

export function documentPickPlugin(): DocumentPlugin {
  let ctx: DocumentContext | null = null;
  let sceneApi: SceneAPI | null = null;

  return {
    name: NAME,
    dependencies: ['scene'],

    install(context: DocumentContext): void {
      ctx = context;
      sceneApi = context.plugins.get<SceneAPI>('scene');
      if (!sceneApi) throw new Error('document-pick requires the scene plugin');

      context.commands.register<{ containerX: number; containerY: number }>(
        'document.pick',
        (a) => {
          if (!ctx || !sceneApi) return;
          const pt = screenToPagePoint(ctx, sceneApi, a.containerX, a.containerY);
          if (!pt) return;
          ctx.events.emit('document:pick', { x: pt.x, y: pt.y, page: ctx.getCurrentPage() });
        },
        { title: 'Pick a normalized page point' },
      );
    },

    uninstall(): void {
      ctx = null;
      sceneApi = null;
    },
  };
}
