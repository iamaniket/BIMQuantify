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
  /** World page size in PDF points (used to size text relative to the page). */
  pageWorld: { w: number; h: number };
}

/**
 * Services the core hands a tool's {@link MarkupInteraction} while drawing.
 * Everything is in **world space** (PDF points, Y-up — the shared scene's
 * coordinate system) unless noted. Screen-px helpers exist for distance checks
 * and for positioning transient DOM (the text input).
 */
export interface MarkupToolContext {
  /** Pointer event → world-space point (PDF pts, Y-up). */
  cursorToWorld(e: PointerEvent | MouseEvent): Pt;
  /** World-space point → screen CSS px (container-relative) for distance checks / DOM placement. */
  worldToScreen(p: Pt): Pt;
  getStyle(): MarkupStyle;
  /** Show a live preview of `points` (world space) for the active tool. */
  preview(points: Pt[], text?: string): void;
  clearPreview(): void;
  /** Finish the shape — stores it as the draft and fires `markup:draftComplete`. */
  submit(points: Pt[], text?: string): void;
  /** Abort the in-progress drawing (keeps the tool active). */
  cancel(): void;
  requestRender(): void;
  /** Viewport-pinned DOM host for transient inputs (e.g. the text entry field). */
  readonly labelHost: HTMLElement;
  /** The interactive root (the document container; use for `setPointerCapture`). */
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
   * Build three.js objects for a shape from world-space points (PDF pts, Y-up).
   * Used for both the live preview and committed rendering, so it must be pure /
   * stateless.
   */
  build(worldPoints: Pt[], style: MarkupStyle, opts: MarkupBuildOpts): THREE.Object3D[];
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
