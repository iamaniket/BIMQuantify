/**
 * A small manager for DOM text labels anchored to world-space points — the 2D
 * counterpart to the 3D viewer's CSS2D labels. Used for measurement value
 * labels (distance / angle / area), which read far crisper as DOM text than as
 * a three.js texture and never need to composite into a snapshot.
 *
 * Labels live in the viewport-pinned overlay (`ctx.viewportOverlay`, NOT
 * CSS-transformed with the page) and are repositioned each frame via
 * `sceneApi.worldToScreen`, so they track pan/zoom with the annotation they
 * label while staying upright and constant-size.
 */

import type { SceneAPI } from '../scene/index.js';

interface LabelEntry {
  el: HTMLElement;
  wx: number;
  wy: number;
}

export interface LabelLayer {
  /** Create (or update) a label with id `id` and text, anchored at world (wx, wy). */
  set(id: string, text: string, wx: number, wy: number): void;
  /** Move an existing label's world anchor. */
  move(id: string, wx: number, wy: number): void;
  remove(id: string): void;
  clear(): void;
  /** Reproject every label to its current on-screen position. */
  syncAll(): void;
  /** Remove the host subtree + all labels. */
  dispose(): void;
}

const BASE_CSS =
  'position:absolute;transform:translate(-50%,-50%);' +
  'padding:1px 5px;border-radius:4px;white-space:nowrap;pointer-events:none;' +
  'font:500 11px ui-sans-serif,system-ui,-apple-system,sans-serif;' +
  'background:rgba(17,24,39,0.85);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);';

export function createLabelLayer(host: HTMLElement, sceneApi: SceneAPI): LabelLayer {
  const labels = new Map<string, LabelEntry>();

  function place(entry: LabelEntry): void {
    const { x, y } = sceneApi.worldToScreen(entry.wx, entry.wy);
    entry.el.style.left = `${x}px`;
    entry.el.style.top = `${y}px`;
  }

  return {
    set(id, text, wx, wy): void {
      let entry = labels.get(id);
      if (!entry) {
        const el = document.createElement('div');
        el.style.cssText = BASE_CSS;
        host.appendChild(el);
        entry = { el, wx, wy };
        labels.set(id, entry);
      }
      entry.el.textContent = text;
      entry.wx = wx;
      entry.wy = wy;
      place(entry);
    },
    move(id, wx, wy): void {
      const entry = labels.get(id);
      if (!entry) return;
      entry.wx = wx;
      entry.wy = wy;
      place(entry);
    },
    remove(id): void {
      const entry = labels.get(id);
      if (!entry) return;
      entry.el.remove();
      labels.delete(id);
    },
    clear(): void {
      for (const entry of labels.values()) entry.el.remove();
      labels.clear();
    },
    syncAll(): void {
      for (const entry of labels.values()) place(entry);
    },
    dispose(): void {
      for (const entry of labels.values()) entry.el.remove();
      labels.clear();
    },
  };
}
