/**
 * 3D-only entry point — the `IfcViewer` value with NO PDF document engine
 * (`DocumentViewer` / `pdf-core` / `pdfjs-dist`) anywhere in its import graph.
 *
 * The embeddable viewer bundle (apps/viewer-embed) imports `IfcViewer` from
 * here, not from the main barrel ('.'), so Vite/Rollup never pull pdfjs into the
 * react-native-webview payload. The main barrel re-exports both 2D and 3D, which
 * is correct for the portal but would drag pdfjs into the embed.
 *
 * Types are erased at build time, so the embed can keep importing them from the
 * main barrel with `import type` — only the runtime value must come from here.
 */
export { IfcViewer } from './IfcViewer.js';
