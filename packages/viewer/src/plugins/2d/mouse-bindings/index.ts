/**
 * 2D mouse-bindings plugin — handles click gestures (select, context-menu,
 * double-click) that camera-controls does not own. Mirrors the 3D
 * mouse-bindings plugin's click detection (threshold + double-click timing)
 * but is much slimmer since drags and wheel are handled by camera-controls.
 *
 * Responsibilities:
 *  - Detect click vs drag (4px threshold)
 *  - Left-click: let text selection / measure interaction through
 *  - Right-click (no drag): dispatch `contextMenu.open` command
 *  - Double-click: dispatch `camera.fitPage` command
 *  - Suppress native contextmenu when right-button has a binding
 */

import type {
  DocumentContext,
  DocumentPlugin,
} from '../../../pdf-core/documentTypes.js';

const NAME = 'mouse-bindings' as const;

const CLICK_THRESHOLD = 4; // px
const DOUBLE_CLICK_MS = 300;

const BUTTON_NAME: Record<number, 'left' | 'middle' | 'right'> = {
  0: 'left',
  1: 'middle',
  2: 'right',
};

export type MouseBindingMap2D = Record<string, string>;

export interface MouseBindings2DPluginOptions {
  overrides?: MouseBindingMap2D;
}

export interface MouseBindings2DAPI {
  bind(gesture: string, commandName: string): void;
  unbind(gesture: string): void;
  list(): { gesture: string; command: string }[];
}

const DEFAULT_BINDINGS: MouseBindingMap2D = {
  'click:right': 'contextMenu.open',
  'doubleclick:left': 'camera.fitPage',
};

export function mouseBindings2DPlugin(
  options: MouseBindings2DPluginOptions = {},
): DocumentPlugin & MouseBindings2DAPI {
  const bindings = new Map<string, string>();

  for (const [g, c] of Object.entries(DEFAULT_BINDINGS)) {
    bindings.set(g, c);
  }
  for (const [g, c] of Object.entries(options.overrides ?? {})) {
    bindings.set(g, c);
  }

  let ctx: DocumentContext | null = null;
  let cleanup: (() => void) | null = null;

  const api: DocumentPlugin & MouseBindings2DAPI = {
    name: NAME,

    bind(gesture: string, commandName: string) {
      bindings.set(gesture, commandName);
    },
    unbind(gesture: string) {
      bindings.delete(gesture);
    },
    list() {
      return [...bindings].map(([gesture, command]) => ({ gesture, command }));
    },

    install(context: DocumentContext): void {
      ctx = context;
      const container = context.container;

      let downX = 0;
      let downY = 0;
      let downBtn = -1;

      let lastClickTime = 0;
      let lastClickButton = -1;
      let lastClickX = 0;
      let lastClickY = 0;

      const onDown = (ev: PointerEvent): void => {
        downX = ev.clientX;
        downY = ev.clientY;
        downBtn = ev.button;
      };

      const onUp = (ev: PointerEvent): void => {
        if (ev.button !== downBtn) return;
        const dx = ev.clientX - downX;
        const dy = ev.clientY - downY;
        if (Math.hypot(dx, dy) > CLICK_THRESHOLD) return;

        const button = BUTTON_NAME[ev.button];
        if (!button) return;

        const gesture = `click:${button}`;
        const cmd = bindings.get(gesture);

        const containerRect = container.getBoundingClientRect();
        const payload = {
          clientX: ev.clientX,
          clientY: ev.clientY,
          containerX: ev.clientX - containerRect.left,
          containerY: ev.clientY - containerRect.top,
          button,
          page: context.getCurrentPage(),
        };

        if (cmd) {
          void context.commands.execute(cmd, payload);
        }

        // Double-click detection
        const now = performance.now();
        const isDouble =
          ev.button === lastClickButton &&
          now - lastClickTime <= DOUBLE_CLICK_MS &&
          Math.hypot(ev.clientX - lastClickX, ev.clientY - lastClickY) <= CLICK_THRESHOLD;

        if (isDouble) {
          const dblGesture = `doubleclick:${button}`;
          const dblCmd = bindings.get(dblGesture);
          if (dblCmd) {
            void context.commands.execute(dblCmd, payload);
          }
          lastClickTime = 0;
          lastClickButton = -1;
        } else {
          lastClickTime = now;
          lastClickButton = ev.button;
          lastClickX = ev.clientX;
          lastClickY = ev.clientY;
        }
      };

      // Listen in capture phase on the container so we see events before
      // camera-controls (which also listens on the container).
      container.addEventListener('pointerdown', onDown, true);
      container.addEventListener('pointerup', onUp, true);

      context.commands.register(
        'mouseBindings.bind',
        (args: unknown) => {
          const a = args as { gesture: string; command: string };
          api.bind(a.gesture, a.command);
        },
        { title: 'Bind mouse gesture' },
      );
      context.commands.register(
        'mouseBindings.unbind',
        (args: unknown) => {
          const a = args as { gesture: string };
          api.unbind(a.gesture);
        },
        { title: 'Unbind mouse gesture' },
      );
      context.commands.register('mouseBindings.list', () => api.list(), {
        title: 'List mouse bindings',
      });

      cleanup = (): void => {
        container.removeEventListener('pointerdown', onDown, true);
        container.removeEventListener('pointerup', onUp, true);
      };
    },

    uninstall(): void {
      cleanup?.();
      cleanup = null;
      bindings.clear();
      ctx = null;
    },
  };

  return api;
}
