import { createRoot } from 'react-dom/client';

// Lightweight subpath (no three/pdfjs) — points the viewer at the WASM + worker
// assets shipped alongside this bundle. Relative paths so they resolve from the
// device filesystem inside react-native-webview (see scripts/copy-wasm.mjs).
import { setWasmPath, setWorkerUrl } from '@bimstitch/viewer/wasm-path';

import { App } from './App';

setWasmPath('./web-ifc/');
setWorkerUrl('./fragments/worker.mjs');

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(<App />);
}
