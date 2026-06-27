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
 * `decodeFloorPlans` is the pdfjs-free floor-plan artifact decoder — kept here so
 * a future native/mobile 2D viewer can decode BIMFPLN2 plans without pulling
 * pdfjs. (The web's 2D viewer is `DocumentViewer`, exported only from the main
 * barrel because it pulls pdfjs.)
 *
 * Types are erased at build time, so the embed can keep importing them from the
 * main barrel with `import type` — only the runtime value must come from here.
 */
export { IfcViewer } from './IfcViewer.js';
export { decodeFloorPlans } from './plugins/3d/shared/floorplan-codec.js';

// Outline plugin — the pdfjs-free 3D hard-edge renderer. The main barrel ('.')
// also exports it, but that path pulls pdfjs (via DocumentViewer); the marketing
// snag showcase adds it as a user plugin under the 'minimal' preset, so it must
// come from this embed-safe entry.
export { outlinePlugin } from './plugins/3d/outline/index.js';
export type {
  OutlinePluginOptions,
  OutlinePluginAPI,
} from './plugins/3d/outline/index.js';

// Raycast helper for custom plugins that need to hit-test the loaded models
// (e.g. the marketing snag showcase pinning markers onto the model surface).
// `core/Raycaster` is pdfjs-free, so it's safe in this embed entry.
export { pick, clientToNdc } from './core/Raycaster.js';
export type { PickResult } from './core/Raycaster.js';
