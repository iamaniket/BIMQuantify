/**
 * Mode-agnostic types for the PDF document engine — the 2D counterpart to the
 * 3D viewer's `core/types.ts`. `DocumentContext`/`DocumentEvents` are to PDF
 * plugins what `ViewerContext`/`ViewerEvents` are to 3D plugins.
 */

import type * as pdfjsLib from 'pdfjs-dist';

import type { CommandRegistry } from '../core/CommandRegistry.js';
import type { EventBus } from '../core/EventBus.js';
import type {
  Plugin as GenericPlugin,
  PluginLifecycleEvents,
  PluginRegistryView,
} from '../core/plugin.js';

/** Pointer/tool mode the document viewer is in. */
export type DocumentTool = 'select' | 'pan' | 'zoom';

/** Page rotation in degrees, clockwise. */
export type DocumentRotation = 0 | 90 | 180 | 270;

/** Rendered (CSS px) size of the current page at the current scale + rotation. */
export interface PageDimensions {
  width: number;
  height: number;
}

/** A page that contains the search query, with its match count. */
export interface DocumentSearchHit {
  /** 1-indexed page number. */
  pageIndex: number;
  matchesOnPage: number;
}

/** Active search highlight request applied to the rendered text layer. */
export interface SearchHighlightState {
  query: string;
  /** 0-based index within the current page's matches. */
  activeMatchIndex: number;
}

/** Scale clamp shared by the engine (safety net) and the zoom plugin. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * Built-in event map for the PDF engine. Plugins MAY emit additional events on
 * the same bus by augmenting this map.
 */
export interface DocumentEvents extends PluginLifecycleEvents {
  'doc:loaded': { numPages: number };
  'doc:unloaded': undefined;
  'doc:error': { error: Error };
  /** Fired after the active page (canvas + text layer) finishes rendering. */
  'page:rendered': {
    pageNumber: number;
    dims: PageDimensions;
    scale: number;
    rotation: DocumentRotation;
  };
  'page:change': { pageNumber: number };
  'scale:change': { scale: number };
  'rotation:change': { rotation: DocumentRotation };
  'tool:change': { tool: DocumentTool };
  'search:results': { query: string; hits: DocumentSearchHit[] };
  /** Active highlight changed (null clears it). */
  'search:highlight': { highlight: SearchHighlightState | null };
  /** Number of matches on the current page after a highlight pass. */
  'search:matchCount': { count: number };
  /** A measurement was added / removed / toggled (panel re-pulls via measure.list). */
  'measurement:change': { count: number };
  /** A measurement was finalized. */
  'measurement:complete': { id: string; type: string; valuePoints: number };
  /** Measurement mode exited (Escape / deactivate). */
  'measure:modeExit': undefined;
}

/**
 * What every PDF plugin gets at install time. Plugins read/drive the document
 * through these getters/setters + the bus and registries — they never touch
 * pdf.js directly except via `getDocument()`/`getPage()`.
 */
export interface DocumentContext {
  /** Scrollable viewport element. */
  container: HTMLElement;
  /** Page raster canvas. */
  canvas: HTMLCanvasElement;
  /** pdf.js TextLayer host (sits over the canvas). */
  textLayer: HTMLElement;
  /** Absolute overlay slot (host-app overlays render here). */
  overlayHost: HTMLElement;

  getDocument(): pdfjsLib.PDFDocumentProxy | null;
  getPage(): pdfjsLib.PDFPageProxy | null;
  getNumPages(): number;
  getCurrentPage(): number;
  getScale(): number;
  getRotation(): DocumentRotation;
  getTool(): DocumentTool;
  /** Rendered size of the current page, or null before first render. */
  getPageDimensions(): PageDimensions | null;
  /** Unscaled (scale=1) page size at the current rotation, or null. */
  getUnscaledViewport(): PageDimensions | null;

  /** Idempotent. Clamps, re-renders, and emits `scale:change`. */
  setScale(scale: number): void;
  setRotation(rotation: DocumentRotation): void;
  setCurrentPage(pageNumber: number): void;
  setTool(tool: DocumentTool): void;
  setSearchHighlight(value: SearchHighlightState | null): void;

  events: EventBus<DocumentEvents>;
  commands: CommandRegistry;
  plugins: PluginRegistryView;
}

/** A PDF plugin: the generic {@link GenericPlugin} bound to {@link DocumentContext}. */
export type DocumentPlugin = GenericPlugin<DocumentContext>;
