/**
 * FloorPlanEngine — the floor-plan counterpart to `pdf-core/DocumentEngine.ts`.
 * It reuses the exact same `DocumentContext` contract (so every world-space 2D
 * plugin — scene/camera/measure/entity-marker/context-menu — runs unchanged)
 * but has NO pdf.js: there is no raster to render. Instead it presents the
 * decoded floor-plan as a synthetic "document" whose pages are the storey
 * levels and whose page box is the STABLE union extent across all levels.
 *
 * Why a standalone class rather than subclassing DocumentEngine: the bulk of
 * DocumentEngine is pdf.js raster logic in `renderActive()` that a plan never
 * runs. Sharing a base would mean extracting an abstract render hook and
 * destabilizing the working PDF path for ~40 lines of trivial setters. The
 * coordinate-bearing types (`DocumentContext`/`DocumentEvents`) are reused
 * directly so plugins stay compatible.
 */

import { CommandRegistry } from '../core/CommandRegistry.js';
import { EventBus } from '../core/EventBus.js';
import { PluginManager } from '../core/plugin.js';
import type {
  DocumentContext,
  DocumentEvents,
  DocumentPlugin,
  DocumentRotation,
  DocumentTool,
  PageDimensions,
  SearchHighlightState,
} from '../pdf-core/documentTypes.js';
import { clampScale } from '../pdf-core/documentTypes.js';
import type { DecodedFloorPlans, FloorPlanLevel } from '../plugins/3d/shared/floorplan-codec.js';
import { unionBbox, type PlanBbox } from '../plugins/3d/shared/floorplanBbox.js';

interface FloorPlanEngineOptions {
  /** Plugins to register at mount. Order matters for dependencies. */
  plugins?: DocumentPlugin[];
}

interface MountElements {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLElement;
  overlayHost: HTMLElement;
  webglHost: HTMLElement;
  viewportOverlay: HTMLElement;
}

export class FloorPlanEngine {
  readonly events = new EventBus<DocumentEvents>();
  readonly commands = new CommandRegistry();

  private pluginManager: PluginManager<DocumentContext, DocumentEvents> | null = null;

  // DOM, set at mount. canvas/textLayer are required by the DocumentContext
  // contract but unused here (no raster, no text layer).
  private container: HTMLElement | null = null;

  // Decoded plan state.
  private levels: FloorPlanLevel[] = [];
  private unionBox: PlanBbox | null = null;

  // Authoritative viewer state. currentPage is the 1-based level index.
  private currentPage = 1;
  private scale = 1;
  private readonly rotation: DocumentRotation = 0; // locked — plans don't rotate
  private tool: DocumentTool = 'select';
  private searchHighlight: SearchHighlightState | null = null;
  private unscaledViewport: PageDimensions | null = null;

  constructor(private readonly options: FloorPlanEngineOptions = {}) {}

  /** Wire the DOM nodes and register the supplied plugins. */
  async mount(elements: MountElements): Promise<void> {
    if (this.container !== null) throw new Error('FloorPlanEngine already mounted');
    this.container = elements.container;

    const ctx: DocumentContext = {
      container: elements.container,
      canvas: elements.canvas,
      textLayer: elements.textLayer,
      overlayHost: elements.overlayHost,
      webglHost: elements.webglHost,
      viewportOverlay: elements.viewportOverlay,
      // No pdf.js document — plan plugins never call these (only `search` does,
      // and it is not mounted for floor plans).
      getDocument: () => null,
      getPage: () => null,
      getNumPages: () => this.levels.length,
      getCurrentPage: () => this.currentPage,
      getScale: () => this.scale,
      getRotation: () => this.rotation,
      getTool: () => this.tool,
      // The rendered page box == unscaled page box (scale lives in the camera,
      // not a raster). Both return the stable union extent dimensions.
      getPageDimensions: () => this.unscaledViewport,
      getUnscaledViewport: () => this.unscaledViewport,
      setScale: (s) => { this.setScale(s); },
      setRotation: () => { /* rotation locked for plans */ },
      setCurrentPage: (n) => { this.setCurrentPage(n); },
      setTool: (t) => { this.setTool(t); },
      setSearchHighlight: (v) => { this.setSearchHighlight(v); },
      events: this.events,
      commands: this.commands,
      plugins: {
        get: <T = unknown>(name: string): T | null =>
          this.pluginManager?.get<T>(name) ?? null,
        has: (name: string) => this.pluginManager?.has(name) ?? false,
      },
    };

    this.pluginManager = new PluginManager(ctx, this.commands, this.events);
    for (const plugin of this.options.plugins ?? []) {
      if (!this.pluginManager) return; // unmount() raced — bail out
      await this.pluginManager.register(plugin);
    }
  }

  // ---- Document lifecycle ----

  /**
   * Load decoded floor-plan data. Synchronous (no network/pdf.js). Computes the
   * stable union page box, emits `doc:loaded`, then a synthetic `page:rendered`
   * so plugins draw the active level + fit the camera. MUST be called after
   * `mount` so the plugins exist to receive the events.
   */
  load(data: DecodedFloorPlans): void {
    this.levels = data.levels;
    this.unionBox = unionBbox(data.levels);
    if (this.unionBox === null) {
      // No geometry — nothing to render.
      this.unscaledViewport = null;
      this.events.emit('doc:loaded', { numPages: 0 });
      return;
    }
    this.unscaledViewport = {
      width: this.unionBox.maxX - this.unionBox.minX,
      height: this.unionBox.maxY - this.unionBox.minY,
    };
    this.currentPage = Math.min(Math.max(1, this.currentPage), this.levels.length);
    this.events.emit('doc:loaded', { numPages: this.levels.length });
    this.emitRendered();
  }

  /** Emit a synthetic page:rendered for the active level (no raster involved). */
  private emitRendered(): void {
    if (this.unscaledViewport === null) return;
    this.events.emit('page:rendered', {
      pageNumber: this.currentPage,
      dims: this.unscaledViewport,
      scale: this.scale,
      rotation: this.rotation,
    });
  }

  // ---- State setters (idempotent; emit) ----

  setCurrentPage(pageNumber: number): void {
    const max = this.levels.length || 1;
    const safe = Math.min(Math.max(1, pageNumber), max);
    if (safe === this.currentPage) return;
    this.currentPage = safe;
    this.events.emit('page:change', { pageNumber: safe });
    // Re-emit page:rendered so the floor-plan plugin redraws the new level.
    // Dims are unchanged (stable union box) so the camera frame doesn't jump.
    this.emitRendered();
  }

  setScale(scale: number): void {
    const next = clampScale(scale);
    if (next === this.scale) return;
    this.scale = next;
    this.events.emit('scale:change', { scale: next });
  }

  setTool(tool: DocumentTool): void {
    if (tool === this.tool) return;
    this.tool = tool;
    this.events.emit('tool:change', { tool });
  }

  setSearchHighlight(value: SearchHighlightState | null): void {
    this.searchHighlight = value;
    this.events.emit('search:highlight', { highlight: value });
  }

  async unmount(): Promise<void> {
    if (this.pluginManager) {
      await this.pluginManager.disposeAll();
      this.pluginManager = null;
    }
    this.levels = [];
    this.unionBox = null;
    this.unscaledViewport = null;
    this.container = null;
    this.events.emit('doc:unloaded', undefined);
    this.events.clear();
  }

  async registerPlugin(plugin: DocumentPlugin): Promise<void> {
    if (!this.pluginManager) throw new Error('FloorPlanEngine is not mounted');
    await this.pluginManager.register(plugin);
  }

  async unregisterPlugin(name: string): Promise<void> {
    if (!this.pluginManager) return;
    await this.pluginManager.unregister(name);
  }

  getPlugin<T = unknown>(name: string): T | null {
    return this.pluginManager?.get<T>(name) ?? null;
  }
}
