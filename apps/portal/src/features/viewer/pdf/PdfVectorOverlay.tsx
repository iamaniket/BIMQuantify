'use client';

import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';

import type { DocumentRotation, PageDimensions } from '@bimstitch/viewer';

import type { PageGeometry } from '@/lib/api/schemas/geometry';

import {
  artifactDistance,
  artifactToCss,
  cssToArtifact,
  type PdfTransformParams,
} from './pdfTransform';
import {
  buildPageSnapData,
  findNearestSnap,
  type PageSnapData,
  type SnapResult,
} from './pdfSnap';

const SNAP_THRESHOLD_PX = 10;
const MARKER_HALF = 7; // px half-extent of the snap marker glyph.
// WebGL canvas content (not DOM) — raw colour numbers are the THREE convention,
// matching the rest of the 3D viewer. Amber marker, primary-blue ink.
const INK_COLOR = 0x2563eb;
const SNAP_COLOR = 0xf59e0b;

export interface CommittedLinePayload {
  /** Artifact-space start point (PDF points, Y-up). */
  start: [number, number];
  /** Artifact-space end point. */
  end: [number, number];
  /** Length in PDF points. */
  lengthPoints: number;
}

interface PdfVectorOverlayProps {
  dims: PageDimensions;
  pageGeometry: PageGeometry | null;
  /** User-applied document rotation (combined with the page's intrinsic rot). */
  rotation: DocumentRotation;
  active: boolean;
  onCommitLine?: (line: CommittedLinePayload) => void;
}

interface CommittedLine {
  id: number;
  a: [number, number];
  b: [number, number];
}

interface ToolState {
  status: 'idle' | 'placing';
  first: [number, number] | null;
}

export function PdfVectorOverlay({
  dims,
  pageGeometry,
  rotation,
  active,
  onCommitLine,
}: PdfVectorOverlayProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const liveLabelRef = useRef<HTMLDivElement>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const committedGroupRef = useRef<THREE.Group | null>(null);
  const inkMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const rubberRef = useRef<THREE.Line | null>(null);
  const rubberPosRef = useRef<Float32Array | null>(null);
  const markerGroupRef = useRef<THREE.Group | null>(null);
  const markerSquareRef = useRef<THREE.LineLoop | null>(null);
  const markerCrossRef = useRef<THREE.LineSegments | null>(null);

  const snapDataRef = useRef<PageSnapData | null>(null);
  const toolStateRef = useRef<ToolState>({ status: 'idle', first: null });
  const liveEndRef = useRef<[number, number] | null>(null);

  const [committedLines, setCommittedLines] = useState<CommittedLine[]>([]);
  const nextIdRef = useRef(1);

  const combinedRotation = (((rotation + (pageGeometry?.rot ?? 0)) % 360) + 360) % 360;
  const params: PdfTransformParams = {
    w: pageGeometry?.w ?? 1,
    h: pageGeometry?.h ?? 1,
    pageW: dims.width,
    pageH: dims.height,
    rotation: combinedRotation,
  };
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const drawingEnabled = active && pageGeometry !== null;

  // ---- One-time THREE setup ----
  useEffect(() => {
    const host = canvasHostRef.current;
    if (host === null) return undefined;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.pointerEvents = 'none';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);

    const committedGroup = new THREE.Group();
    scene.add(committedGroup);

    const inkMaterial = new THREE.LineBasicMaterial({ color: INK_COLOR });

    const rubberPos = new Float32Array(6);
    const rubberGeom = new THREE.BufferGeometry();
    rubberGeom.setAttribute('position', new THREE.BufferAttribute(rubberPos, 3));
    const rubber = new THREE.Line(rubberGeom, inkMaterial);
    rubber.frustumCulled = false;
    rubber.visible = false;
    scene.add(rubber);

    const markerGroup = new THREE.Group();
    markerGroup.visible = false;
    const markerMaterial = new THREE.LineBasicMaterial({ color: SNAP_COLOR });
    const s = MARKER_HALF;
    const squareGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-s, -s, 0),
      new THREE.Vector3(s, -s, 0),
      new THREE.Vector3(s, s, 0),
      new THREE.Vector3(-s, s, 0),
    ]);
    const square = new THREE.LineLoop(squareGeom, markerMaterial);
    square.frustumCulled = false;
    const crossGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-s, -s, 0),
      new THREE.Vector3(s, s, 0),
      new THREE.Vector3(-s, s, 0),
      new THREE.Vector3(s, -s, 0),
    ]);
    const cross = new THREE.LineSegments(crossGeom, markerMaterial);
    cross.frustumCulled = false;
    markerGroup.add(square, cross);
    scene.add(markerGroup);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    committedGroupRef.current = committedGroup;
    inkMaterialRef.current = inkMaterial;
    rubberRef.current = rubber;
    rubberPosRef.current = rubberPos;
    markerGroupRef.current = markerGroup;
    markerSquareRef.current = square;
    markerCrossRef.current = cross;

    return () => {
      committedGroup.traverse((obj) => {
        if (obj instanceof THREE.Line) obj.geometry.dispose();
      });
      rubberGeom.dispose();
      squareGeom.dispose();
      crossGeom.dispose();
      inkMaterial.dispose();
      markerMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode !== null) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  const render = (): void => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (renderer === null || scene === null || camera === null) return;
    renderer.render(scene, camera);
  };

  // ---- Resize + reproject on size / rotation / committed-set change ----
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const committedGroup = committedGroupRef.current;
    const inkMaterial = inkMaterialRef.current;
    if (renderer === null || camera === null || committedGroup === null || inkMaterial === null) {
      return;
    }
    const W = dims.width;
    const H = dims.height;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, true);
    camera.left = 0;
    camera.right = W;
    camera.top = 0;
    camera.bottom = H;
    camera.updateProjectionMatrix();

    // Rebuild committed lines from artifact-space endpoints.
    for (const child of [...committedGroup.children]) {
      if (child instanceof THREE.Line) child.geometry.dispose();
    }
    committedGroup.clear();
    const p = paramsRef.current;
    for (const line of committedLines) {
      const [ax1, ay1] = artifactToCss(line.a[0], line.a[1], p);
      const [ax2, ay2] = artifactToCss(line.b[0], line.b[1], p);
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(ax1, ay1, 0),
        new THREE.Vector3(ax2, ay2, 0),
      ]);
      const obj = new THREE.Line(geom, inkMaterial);
      obj.frustumCulled = false;
      committedGroup.add(obj);
    }

    // Reproject the in-progress rubber-band if mid-placement.
    const ts = toolStateRef.current;
    const rubber = rubberRef.current;
    const rubberPos = rubberPosRef.current;
    if (rubber !== null && rubberPos !== null && ts.status === 'placing' && ts.first !== null && liveEndRef.current !== null) {
      const [fx, fy] = artifactToCss(ts.first[0], ts.first[1], p);
      const [ex, ey] = artifactToCss(liveEndRef.current[0], liveEndRef.current[1], p);
      rubberPos[0] = fx; rubberPos[1] = fy; rubberPos[2] = 0;
      rubberPos[3] = ex; rubberPos[4] = ey; rubberPos[5] = 0;
      rubber.geometry.attributes['position']!.needsUpdate = true;
    }

    render();
  }, [dims.width, dims.height, combinedRotation, committedLines]);

  // ---- Rebuild snap data + reset per page ----
  useEffect(() => {
    snapDataRef.current = pageGeometry !== null ? buildPageSnapData(pageGeometry.l) : null;
    toolStateRef.current = { status: 'idle', first: null };
    liveEndRef.current = null;
    if (rubberRef.current !== null) rubberRef.current.visible = false;
    if (markerGroupRef.current !== null) markerGroupRef.current.visible = false;
    if (liveLabelRef.current !== null) liveLabelRef.current.style.display = 'none';
    setCommittedLines([]);
    render();
  }, [pageGeometry]);

  // ---- Cancel any in-progress placement when the tool deactivates ----
  useEffect(() => {
    if (drawingEnabled) return;
    toolStateRef.current = { status: 'idle', first: null };
    liveEndRef.current = null;
    if (rubberRef.current !== null) rubberRef.current.visible = false;
    if (markerGroupRef.current !== null) markerGroupRef.current.visible = false;
    if (liveLabelRef.current !== null) liveLabelRef.current.style.display = 'none';
    render();
  }, [drawingEnabled]);

  // ---- Escape cancels placement ----
  useEffect(() => {
    if (!drawingEnabled) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancelPlacement();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingEnabled]);

  function cancelPlacement(): void {
    toolStateRef.current = { status: 'idle', first: null };
    liveEndRef.current = null;
    if (rubberRef.current !== null) rubberRef.current.visible = false;
    if (liveLabelRef.current !== null) liveLabelRef.current.style.display = 'none';
    render();
  }

  function cursorToCss(e: ReactPointerEvent<HTMLDivElement>): [number, number] {
    const rect = rootRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function resolvePoint(cssX: number, cssY: number): {
    ax: number;
    ay: number;
    cssX: number;
    cssY: number;
    snap: SnapResult | null;
  } {
    const data = snapDataRef.current;
    const p = paramsRef.current;
    const snap =
      data !== null ? findNearestSnap(data, { x: cssX, y: cssY }, p, SNAP_THRESHOLD_PX) : null;
    if (snap !== null) {
      return { ax: snap.ax, ay: snap.ay, cssX: snap.cssX, cssY: snap.cssY, snap };
    }
    const [ax, ay] = cssToArtifact(cssX, cssY, p);
    return { ax, ay, cssX, cssY, snap: null };
  }

  function updateMarker(resolved: ReturnType<typeof resolvePoint>): void {
    const group = markerGroupRef.current;
    const square = markerSquareRef.current;
    const cross = markerCrossRef.current;
    if (group === null || square === null || cross === null) return;
    if (resolved.snap === null) {
      group.visible = false;
      return;
    }
    group.visible = true;
    group.position.set(resolved.cssX, resolved.cssY, 0);
    square.visible = resolved.snap.kind === 'endpoint';
    cross.visible = resolved.snap.kind === 'intersection';
  }

  function updateLiveLabel(first: [number, number], resolved: ReturnType<typeof resolvePoint>): void {
    const el = liveLabelRef.current;
    if (el === null) return;
    const p = paramsRef.current;
    const [fx, fy] = artifactToCss(first[0], first[1], p);
    const length = artifactDistance(first[0], first[1], resolved.ax, resolved.ay);
    el.textContent = `${length.toFixed(1)} pt`;
    el.style.left = `${(fx + resolved.cssX) / 2}px`;
    el.style.top = `${(fy + resolved.cssY) / 2}px`;
    el.style.display = 'block';
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drawingEnabled) return;
    const [cx, cy] = cursorToCss(e);
    const resolved = resolvePoint(cx, cy);
    updateMarker(resolved);

    const ts = toolStateRef.current;
    const rubber = rubberRef.current;
    const rubberPos = rubberPosRef.current;
    if (ts.status === 'placing' && ts.first !== null && rubber !== null && rubberPos !== null) {
      liveEndRef.current = [resolved.ax, resolved.ay];
      const p = paramsRef.current;
      const [fx, fy] = artifactToCss(ts.first[0], ts.first[1], p);
      rubberPos[0] = fx; rubberPos[1] = fy; rubberPos[2] = 0;
      rubberPos[3] = resolved.cssX; rubberPos[4] = resolved.cssY; rubberPos[5] = 0;
      rubber.geometry.attributes['position']!.needsUpdate = true;
      rubber.visible = true;
      updateLiveLabel(ts.first, resolved);
    }
    render();
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drawingEnabled || e.button !== 0) return;
    e.preventDefault();
    const [cx, cy] = cursorToCss(e);
    const resolved = resolvePoint(cx, cy);
    const ts = toolStateRef.current;

    if (ts.status === 'idle') {
      toolStateRef.current = { status: 'placing', first: [resolved.ax, resolved.ay] };
      liveEndRef.current = [resolved.ax, resolved.ay];
      const rubber = rubberRef.current;
      const rubberPos = rubberPosRef.current;
      if (rubber !== null && rubberPos !== null) {
        rubberPos[0] = resolved.cssX; rubberPos[1] = resolved.cssY; rubberPos[2] = 0;
        rubberPos[3] = resolved.cssX; rubberPos[4] = resolved.cssY; rubberPos[5] = 0;
        rubber.geometry.attributes['position']!.needsUpdate = true;
        rubber.visible = true;
      }
      updateLiveLabel([resolved.ax, resolved.ay], resolved);
      render();
      return;
    }

    // placing → commit
    const first = ts.first;
    if (first === null) return;
    const length = artifactDistance(first[0], first[1], resolved.ax, resolved.ay);
    const id = nextIdRef.current++;
    setCommittedLines((prev) => [...prev, { id, a: first, b: [resolved.ax, resolved.ay] }]);
    onCommitLine?.({ start: first, end: [resolved.ax, resolved.ay], lengthPoints: length });
    toolStateRef.current = { status: 'idle', first: null };
    liveEndRef.current = null;
    if (rubberRef.current !== null) rubberRef.current.visible = false;
    if (liveLabelRef.current !== null) liveLabelRef.current.style.display = 'none';
    render();
  };

  const handleContextMenu = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drawingEnabled) return;
    e.preventDefault();
    cancelPlacement();
  };

  const p = params;
  return (
    <div
      ref={rootRef}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onContextMenu={handleContextMenu}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: dims.width,
        height: dims.height,
        pointerEvents: drawingEnabled ? 'auto' : 'none',
        cursor: drawingEnabled ? 'crosshair' : 'default',
      }}
    >
      <div ref={canvasHostRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Committed length labels — reproject every render via current params. */}
      {committedLines.map((line) => {
        const [mx, my] = midpointCss(line, p);
        const length = artifactDistance(line.a[0], line.a[1], line.b[0], line.b[1]);
        return (
          <div
            key={line.id}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-background/90 px-1.5 py-0.5 text-caption tabular-nums text-foreground shadow-sm"
            style={{ left: mx, top: my }}
          >
            {length.toFixed(1)} pt
          </div>
        );
      })}

      {/* Live length label during placement (positioned imperatively). */}
      <div
        ref={liveLabelRef}
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-background/90 px-1.5 py-0.5 text-caption tabular-nums text-foreground shadow-sm"
        style={{ display: 'none' }}
      />
    </div>
  );
}

function midpointCss(line: CommittedLine, params: PdfTransformParams): [number, number] {
  const [ax1, ay1] = artifactToCss(line.a[0], line.a[1], params);
  const [ax2, ay2] = artifactToCss(line.b[0], line.b[1], params);
  return [(ax1 + ax2) / 2, (ay1 + ay2) / 2];
}
