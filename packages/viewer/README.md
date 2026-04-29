# @bimstitch/viewer

Minimal React component for rendering ThatOpen `.frag` bundles.

## Why this is its own package

Keeps the viewer library swappable. The portal imports `<IfcViewer />` and
nothing else from ThatOpen-land. If we replace ThatOpen with xeokit (or
anything else) later, only `src/ThatOpenScene.ts` and the dependency list
changes — every consumer keeps working.

## Usage

```tsx
import dynamic from 'next/dynamic';

const IfcViewer = dynamic(
  () => import('@bimstitch/viewer').then((m) => m.IfcViewer),
  { ssr: false },
);

<IfcViewer
  bundle={{
    fragmentsUrl: 'https://.../file.frag?presigned=...',
    metadataUrl: 'https://.../file.metadata.json?presigned=...',
  }}
  onReady={() => console.log('viewer ready')}
  onError={(err) => console.error(err)}
/>
```

## WASM

`web-ifc.wasm` must be served from a known URL. Default is `/web-ifc/`.
Override with `setWasmPath('/some/other/path/')` before mounting.

The portal copies the WASM into `public/web-ifc/` via a postinstall script
in `apps/portal/scripts/copy-wasm.mjs`.

## Public API

```ts
type ViewerBundle = {
  fragmentsUrl: string;
  metadataUrl?: string;
  propertiesUrl?: string;
};

type IfcViewerProps = {
  bundle: ViewerBundle;
  className?: string;
  onReady?: () => void;
  onError?: (err: Error) => void;
};

function IfcViewer(props: IfcViewerProps): JSX.Element;
function setWasmPath(path: string): void;
function getWasmPath(): string;
```
