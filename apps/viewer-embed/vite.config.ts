import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Standalone single-page bundle that hosts @bimdossier/viewer for embedding in a
// react-native-webview. `base: './'` makes all asset URLs relative so the built
// index.html works when loaded from the app's local filesystem (file://).
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    // Build-time 3D kill-switch, statically folded so the IfcViewer branch is a
    // compile-time constant. Defaults to 'false' so a v1 build can NEVER mount the
    // 3D pane regardless of what the native shell requests. (It does not slim the
    // bundle — the 2D floor-plan viewer is itself three/web-ifc-based, so those
    // deps ship either way; this flag is the hard safety gate, not a size lever.)
    // Set VITE_ENABLE_3D=true in the build env (e.g. an EAS `preview-3d` profile,
    // paired with native EXPO_PUBLIC_ENABLE_3D_VIEWER) to compile the 3D pane in.
    // Read from the shell env (not just .env files) so CI build hooks pass it through.
    'import.meta.env.VITE_ENABLE_3D': JSON.stringify(process.env.VITE_ENABLE_3D ?? 'false'),
  },
  build: {
    outDir: 'dist',
    target: 'esnext', // web-ifc / fragments use modern JS (incl. top-level await)
    // A 3D IFC viewer (three + web-ifc) is inherently multi-MB; it ships once
    // in-app, not per-session, so the size warning is just noise here.
    chunkSizeWarningLimit: 8000,
  },
});
