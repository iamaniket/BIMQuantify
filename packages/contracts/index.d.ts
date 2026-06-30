/**
 * Type declarations for @bimdossier/contracts. Keep in lockstep with index.cjs.
 *
 * The constants are declared with their string-LITERAL types (not `string`) on
 * purpose: e.g. apps/viewer-embed indexes `window[BRIDGE_RECEIVE_GLOBAL]` and
 * declares `[BRIDGE_RECEIVE_GLOBAL]?` as a computed property, which only type-
 * checks when the value is a literal.
 */

/** Outline artifact binary magic tag. @see index.cjs */
export declare const OUTLINE_MAGIC: 'BIMOUTL2';

/** Floor-plan artifact binary magic tag. @see index.cjs */
export declare const FLOORPLAN_MAGIC: 'BIMFPLN2';

/** Global the viewer-embed WebView installs to receive host→web messages. */
export declare const BRIDGE_RECEIVE_GLOBAL: '__bimdossierViewerReceive';

/** Android in-app assets subdirectory for the viewer-embed bundle. */
export declare const VIEWER_EMBED_ASSET_SUBDIR: 'viewer-embed';

/** Deterministic viewer scene id for a project file (`file-<fileId>`). */
export declare function federatedModelId(fileId: string): string;

/** Prefix for top-level mirrored collections (free → `/pooled`, paid → ``). */
export declare function pooledPrefix(free: boolean): string;

/** Base path for a project's resources (`${projectScope(id, free)}/levels`). */
export declare function projectScope(projectId: string, free: boolean): string;

/** Base path for the projects collection (free → `/pooled/projects`, paid → `/projects`). */
export declare function projectsScope(free: boolean): string;
