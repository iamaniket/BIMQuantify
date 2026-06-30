'use strict';

/**
 * @bimdossier/contracts — the single source of truth for "magic values" that two
 * sides of a package/service seam MUST agree on.
 *
 * Each constant here used to be hand-duplicated across a boundary with no shared
 * source and no guard, so a one-sided edit broke the other side SILENTLY (a
 * codec returning null, a dead bridge, finding pins that don't line up). Import
 * from here instead of re-declaring the literal.
 *
 * Authored as hand-written CommonJS (NO build step, like @bimdossier/tailwind-config)
 * so EVERY consumer can read the exact same value:
 *   - ESM / TypeScript    (@bimdossier/viewer, apps/viewer-embed, apps/portal)
 *   - React Native / Metro (apps/mobile runtime)
 *   - CommonJS Node        (apps/mobile/plugins/withViewerEmbed.js, run via
 *                           `require()` during `expo prebuild` — an ESM-only
 *                           package could not be required there)
 *
 * apps/processor stays decoupled (it has no @bimdossier/* dependency — npm-internal
 * + Docker build), so it keeps its own copies of OUTLINE_MAGIC / FLOORPLAN_MAGIC,
 * pinned to these values by apps/processor/test/format-magic.test.ts.
 *
 * Keep index.d.ts in lockstep with these values (one tiny file, one package).
 */

// --- Binary artifact format tags -------------------------------------------
// Written by apps/processor (pipeline/outline.ts, pipeline/floorplans.ts) and
// decoded by @bimdossier/viewer (plugins/3d/shared/{outline,floorplan}-codec.ts).
// The viewer returns null on a magic mismatch (hides edges / the 2D map) — so a
// one-sided bump fails SILENTLY. Bumping a tag means old S3 artifacts no longer
// decode and every affected model must be re-extracted.
const OUTLINE_MAGIC = 'BIMOUTL2';
const FLOORPLAN_MAGIC = 'BIMFPLN2';

// --- WebView bridge ---------------------------------------------------------
// The global the embedded viewer (apps/viewer-embed/src/bridge.ts) installs to
// receive host→web messages, and the native shell (apps/mobile) calls via
// react-native-webview's injectJavaScript. Rename on one side only and
// native→web messages drop silently.
const BRIDGE_RECEIVE_GLOBAL = '__bimdossierViewerReceive';

// --- In-app viewer-embed asset location -------------------------------------
// The Android assets subdirectory the viewer-embed bundle is copied into by the
// Expo config plugin, and loaded from at runtime
// (file:///android_asset/<subdir>/index.html). The plugin and the runtime
// resolver must agree or the WebView 404s on device.
const VIEWER_EMBED_ASSET_SUBDIR = 'viewer-embed';

// --- Federated viewer scene id ----------------------------------------------
// Deterministic viewer model id for a project file. Finding anchors authored in
// the portal must re-base onto the same model id in the mobile viewer, so both
// sides build it the same way.
function federatedModelId(fileId) {
  return `file-${fileId}`;
}

// --- Free vs paid API-surface routing ---------------------------------------
// Free (org-less) and paid (org-scoped) endpoints return IDENTICAL schemas (the
// backend emits the paid shape for free callers), so a single `free: boolean`
// selects the URL prefix. The clients (apps/portal, apps/mobile) MUST agree with
// the backend's route registration (`/pooled/*` aliases vs the canonical paths in
// apps/api main.py) — this is the one place that prefix is written. Used to be
// hand-duplicated char-for-char in each app's lib/api/scope.ts.

/** Prefix for top-level mirrored collections, e.g. `${pooledPrefix(free)}/notifications`. */
function pooledPrefix(free) {
  return free ? '/pooled' : '';
}

/** Base path for a project's resources, e.g. `${projectScope(id, free)}/levels`. */
function projectScope(projectId, free) {
  return `${free ? '/pooled/projects' : '/projects'}/${projectId}`;
}

/** Base path for the projects collection itself. */
function projectsScope(free) {
  return free ? '/pooled/projects' : '/projects';
}

module.exports = {
  OUTLINE_MAGIC,
  FLOORPLAN_MAGIC,
  BRIDGE_RECEIVE_GLOBAL,
  VIEWER_EMBED_ASSET_SUBDIR,
  federatedModelId,
  pooledPrefix,
  projectScope,
  projectsScope,
};
