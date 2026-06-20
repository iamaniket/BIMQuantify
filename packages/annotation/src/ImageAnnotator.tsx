'use client';

/**
 * Interactive image annotator. A controlled component: the host owns the
 * annotation document (`value`/`onChange`), the active tool, the style, and the
 * current selection. It renders the image (object-contain) with an SVG overlay
 * sized exactly to the displayed image rect, and turns pointer gestures into
 * normalized `Annotation2D` shapes.
 *
 * Live drags (moving/resizing an existing shape, or rubber-banding a new one)
 * are previewed locally and committed to `onChange` ONCE on pointer-up, so the
 * host's undo history gets one entry per gesture, not one per mouse move.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { clamp01, normBBox, normToPx, type NormPoint } from './coords.js';
import {
  ShapeView,
  TOOL_POINT_MODE,
  annotationNormBox,
  handlePoints,
  hitTest,
  type RenderBox,
} from './shapes.js';
import type { ToolbarTool } from './AnnotationToolbar.js';
import type { Annotation2D } from './types.js';

const DRAG_THRESHOLD_PX = 3;
const FREEHAND_MIN_STEP_PX = 3;
const HANDLE_RADIUS = 5;
const HANDLE_HIT_PX = 11;
const HIT_TOL_PX = 8;

export interface ImageAnnotatorProps {
  imageUrl: string;
  value: Annotation2D[];
  onChange: (next: Annotation2D[]) => void;
  tool: ToolbarTool;
  onToolChange: (tool: ToolbarTool) => void;
  color: string;
  strokeWidth: number;
  selectedId: string | null;
  onSelectedIdChange: (id: string | null) => void;
  readOnly?: boolean;
  className?: string;
  /** Reports the source image's natural pixel size once loaded (for export sizing). */
  onImageLoad?: (size: { width: number; height: number }) => void;
  /** Forwarded to the <img> so the export canvas isn't tainted (use 'anonymous'). */
  crossOrigin?: 'anonymous' | 'use-credentials';
}

type Gesture =
  | { kind: 'draw-two'; start: NormPoint }
  | { kind: 'draw-path'; lastPx: [number, number] }
  | { kind: 'move'; id: string; lastNorm: NormPoint; moved: boolean }
  | { kind: 'resize'; id: string; handleIndex: number }
  | null;

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `a-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function fitContain(natW: number, natH: number, boxW: number, boxH: number): RenderBox {
  if (natW <= 0 || natH <= 0 || boxW <= 0 || boxH <= 0) return { width: 0, height: 0 };
  const scale = Math.min(boxW / natW, boxH / natH);
  return { width: natW * scale, height: natH * scale };
}

/** Rigidly translate points by (dx,dy), clamping so the bbox stays inside 0..1. */
function translatePoints(points: [number, number][], dx: number, dy: number): [number, number][] {
  const box = normBBox(points);
  const cdx = Math.max(-box.x, Math.min(1 - (box.x + box.w), dx));
  const cdy = Math.max(-box.y, Math.min(1 - (box.y + box.h), dy));
  return points.map(([x, y]) => [x + cdx, y + cdy] as [number, number]);
}

export function ImageAnnotator({
  imageUrl,
  value,
  onChange,
  tool,
  onToolChange,
  color,
  strokeWidth,
  selectedId,
  onSelectedIdChange,
  readOnly = false,
  className,
  onImageLoad,
  crossOrigin,
}: ImageAnnotatorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Live gesture state.
  const gesture = useRef<Gesture>(null);
  const [draft, setDraft] = useState<Annotation2D | null>(null);
  const [working, setWorking] = useState<Annotation2D[] | null>(null);

  // Text editing.
  const [textEdit, setTextEdit] = useState<{ mode: 'new'; point: NormPoint } | { mode: 'edit'; id: string } | null>(null);
  const [textDraft, setTextDraft] = useState('');

  const stage = useMemo<RenderBox>(
    () => (natural ? fitContain(natural.width, natural.height, containerSize.width, containerSize.height) : { width: 0, height: 0 }),
    [natural, containerSize],
  );

  // Track the container size.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null) return undefined;
    const measure = (): void => { setContainerSize({ width: el.clientWidth, height: el.clientHeight }); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  const displayValue = working ?? value;
  const ready = stage.width > 0 && stage.height > 0;
  const drawing = tool !== 'select';

  const getNorm = useCallback((e: { clientX: number; clientY: number }): NormPoint => {
    const svg = svgRef.current;
    if (svg === null) return [0, 0];
    const r = svg.getBoundingClientRect();
    return [
      clamp01(r.width === 0 ? 0 : (e.clientX - r.left) / r.width),
      clamp01(r.height === 0 ? 0 : (e.clientY - r.top) / r.height),
    ];
  }, []);

  const commitText = useCallback(() => {
    const edit = textEdit;
    if (edit === null) return;
    const trimmed = textDraft.trim();
    if (edit.mode === 'new') {
      if (trimmed !== '') {
        const a: Annotation2D = { id: newId(), tool: 'text', points: [edit.point], text: trimmed, color, strokeWidth };
        onChange([...value, a]);
        onSelectedIdChange(a.id);
      }
    } else {
      if (trimmed === '') {
        onChange(value.filter((x) => x.id !== edit.id));
        onSelectedIdChange(null);
      } else {
        onChange(value.map((x) => (x.id === edit.id ? { ...x, text: trimmed } : x)));
      }
    }
    setTextEdit(null);
    setTextDraft('');
  }, [textEdit, textDraft, color, strokeWidth, value, onChange, onSelectedIdChange]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (readOnly || !ready) return;
      if (e.button !== 0) return;
      if (textEdit !== null) { commitText(); return; }
      e.preventDefault();
      const p = getNorm(e);
      svgRef.current?.setPointerCapture(e.pointerId);

      if (drawing) {
        const mode = TOOL_POINT_MODE[tool as Annotation2D['tool']];
        if (mode === 'single') {
          // Text: defer creation until the user types something.
          setTextEdit({ mode: 'new', point: p });
          setTextDraft('');
          return;
        }
        if (mode === 'two') {
          gesture.current = { kind: 'draw-two', start: p };
          setDraft({ id: 'draft', tool: tool as Annotation2D['tool'], points: [p, p], color, strokeWidth });
        } else {
          gesture.current = { kind: 'draw-path', lastPx: normToPx(p, stage.width, stage.height) };
          setDraft({ id: 'draft', tool: 'freehand', points: [p], color, strokeWidth });
        }
        return;
      }

      // Select mode.
      const px = normToPx(p, stage.width, stage.height);
      const selected = value.find((a) => a.id === selectedId) ?? null;
      if (selected !== null) {
        const handles = handlePoints(selected);
        for (let i = 0; i < handles.length; i += 1) {
          const hpx = normToPx(handles[i]!, stage.width, stage.height);
          if (Math.hypot(px[0] - hpx[0], px[1] - hpx[1]) <= HANDLE_HIT_PX) {
            gesture.current = { kind: 'resize', id: selected.id, handleIndex: i };
            return;
          }
        }
      }
      // Topmost shape under the pointer (last drawn = visually on top).
      let hit: Annotation2D | null = null;
      for (let i = value.length - 1; i >= 0; i -= 1) {
        if (hitTest(value[i]!, px, stage, HIT_TOL_PX)) { hit = value[i]!; break; }
      }
      if (hit !== null) {
        onSelectedIdChange(hit.id);
        gesture.current = { kind: 'move', id: hit.id, lastNorm: p, moved: false };
      } else {
        onSelectedIdChange(null);
      }
    },
    [readOnly, ready, textEdit, commitText, getNorm, drawing, tool, color, strokeWidth, stage, value, selectedId, onSelectedIdChange],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const g = gesture.current;
      if (g === null) return;
      const p = getNorm(e);

      if (g.kind === 'draw-two') {
        setDraft((d) => (d === null ? d : { ...d, points: [g.start, p] }));
      } else if (g.kind === 'draw-path') {
        const px = normToPx(p, stage.width, stage.height);
        if (Math.hypot(px[0] - g.lastPx[0], px[1] - g.lastPx[1]) >= FREEHAND_MIN_STEP_PX) {
          g.lastPx = px;
          setDraft((d) => (d === null ? d : { ...d, points: [...d.points, p] }));
        }
      } else if (g.kind === 'move') {
        const dx = p[0] - g.lastNorm[0];
        const dy = p[1] - g.lastNorm[1];
        g.lastNorm = p;
        g.moved = true;
        setWorking((prev) => (prev ?? value).map((a) => (a.id === g.id ? { ...a, points: translatePoints(a.points, dx, dy) } : a)));
      } else {
        // resize
        setWorking((prev) =>
          (prev ?? value).map((a) =>
            a.id === g.id ? { ...a, points: a.points.map((pt, i) => (i === g.handleIndex ? p : pt)) } : a,
          ),
        );
      }
    },
    [getNorm, stage, value],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const g = gesture.current;
      gesture.current = null;
      svgRef.current?.releasePointerCapture(e.pointerId);

      if (g === null) return;

      if (g.kind === 'draw-two') {
        const d = draft;
        setDraft(null);
        if (d !== null && d.points.length === 2) {
          const a = normToPx(d.points[0]!, stage.width, stage.height);
          const b = normToPx(d.points[1]!, stage.width, stage.height);
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= DRAG_THRESHOLD_PX) {
            const committed: Annotation2D = { ...d, id: newId() };
            onChange([...value, committed]);
            onSelectedIdChange(committed.id);
            onToolChange('select');
          }
        }
      } else if (g.kind === 'draw-path') {
        const d = draft;
        setDraft(null);
        if (d !== null && d.points.length >= 2) {
          const committed: Annotation2D = { ...d, id: newId() };
          onChange([...value, committed]);
          onSelectedIdChange(committed.id);
          onToolChange('select');
        }
      } else if (working !== null) {
        // move / resize — commit the working copy as one history entry.
        onChange(working);
        setWorking(null);
      }
    },
    [draft, working, stage, value, onChange, onSelectedIdChange, onToolChange],
  );

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (readOnly || !ready || drawing) return;
      const px = normToPx(getNorm(e), stage.width, stage.height);
      for (let i = value.length - 1; i >= 0; i -= 1) {
        const a = value[i]!;
        if (a.tool === 'text' && hitTest(a, px, stage, HIT_TOL_PX)) {
          setTextEdit({ mode: 'edit', id: a.id });
          setTextDraft(a.text ?? '');
          onSelectedIdChange(a.id);
          return;
        }
      }
    },
    [readOnly, ready, drawing, getNorm, stage, value, onSelectedIdChange],
  );

  const selected = useMemo(() => displayValue.find((a) => a.id === selectedId) ?? null, [displayValue, selectedId]);
  const selBox = selected !== null && !readOnly ? annotationNormBox(selected, stage) : null;
  const selHandles = selected !== null && !readOnly ? handlePoints(selected) : [];

  // Position of the text input overlay (px within the stage).
  const textInputPos = useMemo<[number, number] | null>(() => {
    if (textEdit === null) return null;
    if (textEdit.mode === 'new') return normToPx(textEdit.point, stage.width, stage.height);
    const a = value.find((x) => x.id === textEdit.id);
    return a ? normToPx(a.points[0]!, stage.width, stage.height) : null;
  }, [textEdit, value, stage]);

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden ${className ?? ''}`}
    >
      <div className="relative" style={{ width: stage.width, height: stage.height }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          crossOrigin={crossOrigin}
          onLoad={(e) => {
            const img = e.currentTarget;
            const size = { width: img.naturalWidth, height: img.naturalHeight };
            setNatural(size);
            onImageLoad?.(size);
          }}
          className="block h-full w-full select-none object-contain"
        />
        {ready && (
          <svg
            ref={svgRef}
            width={stage.width}
            height={stage.height}
            viewBox={`0 0 ${stage.width} ${stage.height}`}
            className="absolute inset-0"
            style={{ touchAction: 'none', cursor: drawing ? 'crosshair' : 'default' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
          >
            {displayValue.map((a) => (
              <ShapeView key={a.id} a={a} box={stage} />
            ))}
            {draft !== null && <ShapeView a={draft} box={stage} />}

            {selBox !== null && (
              <rect
                x={selBox.x * stage.width - 3}
                y={selBox.y * stage.height - 3}
                width={selBox.w * stage.width + 6}
                height={selBox.h * stage.height + 6}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={1}
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            )}
            {selHandles.map((h, i) => {
              const px = normToPx(h, stage.width, stage.height);
              return (
                <circle
                  key={i}
                  cx={px[0]}
                  cy={px[1]}
                  r={HANDLE_RADIUS}
                  fill="var(--background)"
                  stroke="var(--primary)"
                  strokeWidth={1.5}
                />
              );
            })}
          </svg>
        )}

        {textInputPos !== null && (
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={textDraft}
            onChange={(e) => { setTextDraft(e.target.value); }}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitText(); }
              if (e.key === 'Escape') { e.preventDefault(); setTextEdit(null); setTextDraft(''); }
            }}
            className="absolute rounded border border-primary bg-background px-1 text-body3 text-foreground shadow-sm outline-none"
            style={{ left: textInputPos[0], top: textInputPos[1], minWidth: 80 }}
          />
        )}
      </div>
    </div>
  );
}
