/**
 * PDF rotate plugin. Exposes commands to rotate the page in 90° steps. The
 * engine re-renders at the new rotation and emits `rotation:change`.
 */

import type {
  DocumentContext,
  DocumentPlugin,
  DocumentRotation,
} from '../../../pdf-core/documentTypes.js';

function rotateDelta(rot: DocumentRotation, delta: 90 | -90): DocumentRotation {
  return (((rot + delta + 360) % 360) as DocumentRotation);
}

export function rotatePlugin(): DocumentPlugin {
  return {
    name: 'rotate',

    install(context: DocumentContext): void {
      context.commands.register<{ deg: 90 | -90 }>('rotate.by', (args) => {
        context.setRotation(rotateDelta(context.getRotation(), args.deg));
      }, { title: 'Rotate' });
      context.commands.register('rotate.right', () => {
        context.setRotation(rotateDelta(context.getRotation(), 90));
      }, { title: 'Rotate right', defaultShortcut: 'R' });
      context.commands.register('rotate.left', () => {
        context.setRotation(rotateDelta(context.getRotation(), -90));
      }, { title: 'Rotate left', defaultShortcut: 'Shift+R' });
      context.commands.register<{ rotation: DocumentRotation }>('rotate.to', (args) => {
        context.setRotation(args.rotation);
      }, { title: 'Rotate to' });
    },
  };
}
