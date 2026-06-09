/**
 * Plugin-contract types shared between `markup-core` and the per-shape plugins.
 * Unlike `../types.ts` (host-importable data), these reference three.js and the
 * document engine, so they stay viewer-internal.
 *
 * A shape plugin contributes a {@link MarkupToolDefinition} via
 * `core.registerTool(def)`; the core owns everything else (overlay, draft +
 * committed state, pointer routing, hit-testing, snapshot, commands, events).
 */

import type * as THREE from 'three';

import type { Pt } from '../../measure/math.js';
import type { MarkupStyle, MarkupTool } from '../types.js';

/**
 * Extra context passed to {@link MarkupToolDefinition.build}. The build creates
 * its own materials (via `makeLineMaterial` / `makeFillMaterial` from
 * `core/draw.ts`) so the core never holds an unused material.
 */
export interface MarkupBuildOpts {
  /** Present for `tool === 'text'`. */
  text?: string;
  /** Rendered page size in CSS px (used to size text relative to the page). */
  pageCss: { w: number; h: number };
}

/**
 * Services the core hands a tool's {@link MarkupInteraction} while drawing.
 * Everything is in artifact space (PDF points) unless noted — the same space
 * the measure plugin stores in, so the shared transforms apply unchanged.
 */
export interface MarkupToolContext {
  /** Pointer event → artifact-space point (PDF pts). */
  cursorToArtifact(e: PointerEvent | MouseEvent): Pt;
  /** Artifact-space point → CSS px (for distance checks during drawing). */
  artifactToCss(p: Pt): Pt;
  getStyle(): MarkupStyle;
  /** Show a live preview of `points` (artifact space) for the active tool. */
  preview(points: Pt[], text?: string): void;
  clearPreview(): void;
  /** Finish the shape — stores it as the draft and fires `markup:draftComplete`. */
  submit(points: Pt[], text?: string): void;
  /** Abort the in-progress drawing (keeps the tool active). */
  cancel(): void;
  requestRender(): void;
  /** Page-aligned DOM host for transient inputs (e.g. the text entry field). */
  readonly labelHost: HTMLElement;
  /** The interactive overlay root (use for `setPointerCapture`). */
  readonly root: HTMLElement;
  /** Current 1-based page. */
  page(): number;
}

/** A drawing state machine for one tool. The core forwards pointer/key events. */
export interface MarkupInteraction {
  onPointerDown?(e: PointerEvent): void;
  onPointerMove?(e: PointerEvent): void;
  onPointerUp?(e: PointerEvent): void;
  onDoubleClick?(e: MouseEvent): void;
  /** Cleanup when the tool deactivates (remove a text input, etc.). */
  dispose?(): void;
}

/** What a shape plugin registers with the core. */
export interface MarkupToolDefinition {
  tool: MarkupTool;
  /**
   * Build three.js objects for a shape from CSS-px points. Used for both the
   * live preview and committed rendering, so it must be pure / stateless.
   */
  build(cssPoints: Pt[], style: MarkupStyle, opts: MarkupBuildOpts): THREE.Object3D[];
  /** Create the drawing interaction, bound to the given tool context. */
  createInteraction(ctx: MarkupToolContext): MarkupInteraction;
}

/** Public surface of `markup-core`, reachable via `ctx.plugins.get('markup-core')`. */
export interface MarkupCoreAPI {
  /** Register a shape tool. Called by each per-shape plugin at install. */
  registerTool(def: MarkupToolDefinition): void;
  isActive(): boolean;
  mode(): MarkupTool | null;
}
