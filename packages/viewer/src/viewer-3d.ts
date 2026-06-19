/**
 * Embed-safe (no-pdfjs) entry point — the viewer runtime values with NO PDF
 * document engine (`DocumentViewer` / `pdf-core` / `pdfjs-dist`) anywhere in
 * their import graph.
 *
 * The embeddable viewer bundle (apps/viewer-embed) imports its runtime values
 * from here, not from the main barrel ('.'), so Vite/Rollup never pull pdfjs
 * into the react-native-webview payload. The main barrel re-exports the PDF
 * `DocumentViewer` too, which is correct for the portal but would drag pdfjs
 * into the embed.
 *
 * `FloorPlanViewer` + `decodeFloorPlans` are the world-space 2D floor-plan
 * engine; they are pdfjs-free at runtime (the only pdfjs references under
 * `floorplan-core/` + `plugins/2d/` are comments/tests), so they belong here
 * for the embed's 2D/Split views.
 *
 * Types are erased at build time, so the embed can keep importing them from the
 * main barrel with `import type` — only the runtime value must come from here.
 */
export { IfcViewer } from './IfcViewer.js';
export { FloorPlanViewer } from './FloorPlanViewer.js';
export { decodeFloorPlans } from './plugins/3d/shared/floorplan-codec.js';

// Raycast helper for custom plugins that need to hit-test the loaded models
// (e.g. the marketing snag showcase pinning markers onto the model surface).
// `core/Raycaster` is pdfjs-free, so it's safe in this embed entry.
export { pick, clientToNdc } from './core/Raycaster.js';
export type { PickResult } from './core/Raycaster.js';
