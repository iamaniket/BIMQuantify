/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Build-time gate for the 3D `IfcViewer` pane. `'true'` compiles the 3D
   * renderer into the bundle; anything else (the default) tree-shakes it out so
   * the v1 embed stays 2D-only and lean. Paired at runtime with the native
   * `EXPO_PUBLIC_ENABLE_3D_VIEWER` flag (see apps/mobile/src/lib/env.ts).
   */
  readonly VITE_ENABLE_3D?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
