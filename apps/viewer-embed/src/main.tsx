import { createRoot } from 'react-dom/client';

// Lightweight subpath (no three/pdfjs) — points the viewer at the WASM + worker
// assets shipped alongside this bundle. Relative paths so it resolves from
// file:// inside react-native-webview. The IfcViewer host + bridge land next.
import { setWasmPath, setWorkerUrl } from '@bimstitch/viewer/wasm-path';

setWasmPath('./web-ifc/');
setWorkerUrl('./fragments/worker.mjs');

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>viewer-embed scaffold OK</div>,
  );
}
