import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Standalone single-page bundle that hosts @bimstitch/viewer for embedding in a
// react-native-webview. `base: './'` makes all asset URLs relative so the built
// index.html works when loaded from the app's local filesystem (file://).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    target: 'esnext', // web-ifc / fragments use modern JS (incl. top-level await)
    // A 3D IFC viewer (three + web-ifc) is inherently multi-MB; it ships once
    // in-app, not per-session, so the size warning is just noise here.
    chunkSizeWarningLimit: 8000,
  },
});
