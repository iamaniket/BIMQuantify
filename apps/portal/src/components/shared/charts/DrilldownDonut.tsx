'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { Eyebrow } from '@bimdossier/ui';

/**
 * One interactive donut chart that *reshapes* in place. The overview is a single
 * ring split into one wedge per metric (each wedge shows its own filled/remaining
 * progress). Clicking a wedge grows it to fill the whole ring while the other
 * wedges shrink to zero, and the growing wedge subdivides into that metric's
 * breakdown — the same SVG arcs re-proportion, split, and merge. "Back" reverses
 * the reshape.
 *
 * Pure SVG with `var(--token)` fills (re-themes for free). The angular animation
 * is a single `requestAnimationFrame` tween of one parameter `t` (0 = overview,
 * 1 = active wedge fully expanded + subdivided). Note: rAF is paused inside
 * Claude_Preview — observe the reshape on a real browser.
 *
 * Store-agnostic: all data flows in via props (see CLAUDE.md `components/shared/`
 * rule), so it can drive any "overview → per-segment breakdown" chart.
 */

export type DonutDetailSegment = {
  label: string;
  value: number;
  /** Any CSS color — prefer a token, e.g. `var(--success)`. */
  color: string;
};

export type DonutWedge = {
  /** Stable identity. */
  key: string;
  /** Localized label (legend + aria). */
  label: string;
  /** Wedge color (token). */
  color: string;
  /** Overview wedge angular size (e.g. the metric's scope). */
  weight: number;
  /** Figures for the legend row + the in-wedge filled/remaining split. */
  meta: { value: number; total: number; pct: number };
  /** Center text shown while this wedge is the active (expanded) one. */
  center: { value: string; label: string };
  /** Composition shown when this wedge is expanded (may be all-zero / empty). */
  detail: DonutDetailSegment[];
  /** Message + faded ring when `detail` has no positive values. */
  empty?: string;
};

type Props = {
  /** Index 0 starts at 12 o'clock, laid clockwise by `weight`. */
  wedges: DonutWedge[];
  /** Center text in overview mode (e.g. the overall aggregate). */
  overviewCenter: { value: string; label: string };
  /** Eyebrow/title shown in the header while in overview mode. */
  title: string;
  /** Label for the Back control shown while a wedge is expanded. */
  backLabel: string;
  /** Optional node rendered at the right of the header in overview mode. */
  headerRight?: ReactNode;
  reducedMotion?: boolean;
  ariaLabelFor?: (w: DonutWedge) => string;
  /** Wrap each overview wedge's transparent hit path so the caller can attach a
   * tooltip without this primitive importing Radix. */
  renderWedgeHit?: (w: DonutWedge, hit: JSX.Element) => JSX.Element;
  onActiveChange?: (key: string | null) => void;
};

// Geometry is in viewBox units; the SVG scales to its container width.
const VIEW = 240;
const C = VIEW / 2;
// Radii fill the square tightly (outer diameter ≈ 99% of the viewBox) so the
// donut reads as large as possible inside its rendered box.
const R_OUTER = 118;
const R_INNER = 74;
const GAP = 1.4; // degrees between adjacent segments
const EPS = 0.25;
const REMAINING_OPACITY = 0.16;
const FADED_FILL = 'var(--foreground-tertiary)';
const FADED_OPACITY = 0.22;
const DURATION_MS = 600;

type Arc = { d: string; ring: boolean };
type Seg = { key: string; d: string; fill: string; opacity: number; ring: boolean };
type Slot = { wedge: DonutWedge; index: number; start: number; end: number };

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function polar(r: number, deg: number): string {
  const a = ((deg - 90) * Math.PI) / 180;
  return `${(C + r * Math.cos(a)).toFixed(2)},${(C + r * Math.sin(a)).toFixed(2)}`;
}

/** Full donut ring (outer circle + inner hole) — filled with `fill-rule: evenodd`. */
function ringPath(): string {
  return (
    `M ${polar(R_OUTER, 0)} A ${R_OUTER} ${R_OUTER} 0 1 1 ${polar(R_OUTER, 180)} ` +
    `A ${R_OUTER} ${R_OUTER} 0 1 1 ${polar(R_OUTER, 0)} Z ` +
    `M ${polar(R_INNER, 0)} A ${R_INNER} ${R_INNER} 0 1 1 ${polar(R_INNER, 180)} ` +
    `A ${R_INNER} ${R_INNER} 0 1 1 ${polar(R_INNER, 0)} Z`
  );
}

function buildArc(startDeg: number, endDeg: number): Arc {
  if (endDeg - startDeg >= 359.5) return { d: ringPath(), ring: true };
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return {
    d:
      `M ${polar(R_OUTER, startDeg)} A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${polar(R_OUTER, endDeg)} ` +
      `L ${polar(R_INNER, endDeg)} A ${R_INNER} ${R_INNER} 0 ${large} 0 ${polar(R_INNER, startDeg)} Z`,
    ring: false,
  };
}

/** Inset a span by GAP/2 on each side when there is room, for a hairline gap. */
function trim(a: number, b: number): [number, number] {
  if (b - a > GAP * 1.5) return [a + GAP / 2, b - GAP / 2];
  return [a, b];
}

/** Track the rendered size so the chart caps its width and never overflows. */
function useMeasuredBox(): [RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const measure = (): void => { setBox({ w: el.clientWidth, h: el.clientHeight }); };
    measure();
    const ro = new ResizeObserver(() => { measure(); });
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);
  return [ref, box];
}

export function DrilldownDonut({
  wedges,
  overviewCenter,
  title,
  backLabel,
  headerRight,
  reducedMotion = false,
  ariaLabelFor,
  renderWedgeHit,
  onActiveChange,
}: Props): JSX.Element {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [t, setT] = useState(0); // 0 = overview, 1 = active wedge fully expanded
  const tRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const [boxRef, box] = useMeasuredBox();

  // Overview wedge angles, laid clockwise from 12 o'clock by weight.
  const slots = useMemo<Slot[]>(() => {
    const totalW = wedges.reduce((s, w) => s + Math.max(w.weight, 0), 0) || 1;
    let acc = 0;
    return wedges.map((wedge, index) => {
      const span = (Math.max(wedge.weight, 0) / totalW) * 360;
      const slot = { wedge, index, start: acc, end: acc + span };
      acc += span;
      return slot;
    });
  }, [wedges]);

  const setTBoth = useCallback((v: number) => {
    tRef.current = v;
    setT(v);
  }, []);

  const cancelRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const animateTo = useCallback(
    (target: number, onDone?: () => void) => {
      cancelRaf();
      if (reducedMotion) {
        setTBoth(target);
        onDone?.();
        return;
      }
      const from = tRef.current;
      const start = performance.now();
      const loop = (now: number): void => {
        const p = Math.min((now - start) / DURATION_MS, 1);
        setTBoth(lerp(from, target, easeInOut(p)));
        if (p < 1) {
          rafRef.current = requestAnimationFrame(loop);
        } else {
          rafRef.current = null;
          setTBoth(target);
          onDone?.();
        }
      };
      rafRef.current = requestAnimationFrame(loop);
    },
    [cancelRaf, reducedMotion, setTBoth],
  );

  const expand = useCallback(
    (i: number) => {
      const w = wedges[i];
      if (w === undefined) return;
      setActiveIndex(i);
      setHoverIndex(null);
      onActiveChange?.(w.key);
      animateTo(1);
    },
    [wedges, animateTo, onActiveChange],
  );

  const collapse = useCallback(() => {
    animateTo(0, () => {
      setActiveIndex(null);
      onActiveChange?.(null);
    });
  }, [animateTo, onActiveChange]);

  // Escape collapses an expanded wedge, regardless of focus.
  useEffect(() => {
    if (activeIndex === null) return undefined;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') collapse();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [activeIndex, collapse]);

  useEffect(() => cancelRaf, [cancelRaf]);

  // Reshape geometry for the current (t, activeIndex). Recomputed each frame.
  const segments = useMemo<Seg[]>(() => {
    const segs: Seg[] = [];

    const pushOverview = (a: number, b: number, w: DonutWedge, op: number, kp: string): void => {
      if (op <= 0) return;
      const [A, B] = trim(a, b);
      if (B - A <= EPS) return;
      const frac = w.meta.total > 0 ? clamp01(w.meta.value / w.meta.total) : 0;
      const mid = A + frac * (B - A);
      if (mid - A > EPS) {
        const arc = buildArc(A, mid);
        segs.push({ key: `${kp}-f`, d: arc.d, fill: w.color, opacity: op, ring: arc.ring });
      }
      if (B - mid > EPS) {
        const arc = buildArc(mid, B);
        segs.push({ key: `${kp}-r`, d: arc.d, fill: w.color, opacity: op * REMAINING_OPACITY, ring: arc.ring });
      }
    };

    const pushDetail = (a: number, b: number, w: DonutWedge, op: number, kp: string): void => {
      if (op <= 0 || b - a <= EPS) return;
      const det = w.detail.filter((d) => d.value > 0);
      if (det.length === 0) {
        const arc = buildArc(a, b);
        segs.push({ key: `${kp}-e`, d: arc.d, fill: FADED_FILL, opacity: op * FADED_OPACITY, ring: arc.ring });
        return;
      }
      if (det.length === 1) {
        const only = det[0];
        if (only !== undefined) {
          const arc = buildArc(a, b);
          segs.push({ key: `${kp}-d0`, d: arc.d, fill: only.color, opacity: op, ring: arc.ring });
        }
        return;
      }
      const tot = det.reduce((s, d) => s + d.value, 0);
      let acc = a;
      det.forEach((d, i) => {
        const e = acc + (d.value / tot) * (b - a);
        const [A, B] = trim(acc, e);
        if (B - A > EPS) {
          const arc = buildArc(A, B);
          segs.push({ key: `${kp}-d${String(i)}`, d: arc.d, fill: d.color, opacity: op, ring: arc.ring });
        }
        acc = e;
      });
    };

    if (activeIndex === null) {
      slots.forEach((s) => {
        const op = hoverIndex === null || hoverIndex === s.index ? 1 : 0.4;
        pushOverview(s.start, s.end, s.wedge, op, `ov-${s.wedge.key}`);
      });
      return segs;
    }

    const k = slots[activeIndex];
    if (k === undefined) return segs;
    const ws = lerp(k.start, 0, t);
    const we = lerp(k.end, 360, t);

    // Other wedges squeeze into the shrinking remainder, fading out.
    const beforeSpan = k.start;
    const afterSpan = 360 - k.end;
    const bScale = beforeSpan > 0 ? ws / beforeSpan : 0;
    let acc = 0;
    for (let i = 0; i < activeIndex; i += 1) {
      const s = slots[i];
      if (s === undefined) continue;
      const sp = (s.end - s.start) * bScale;
      pushOverview(acc, acc + sp, s.wedge, 1 - t, `b-${s.wedge.key}`);
      acc += sp;
    }
    const aScale = afterSpan > 0 ? (360 - we) / afterSpan : 0;
    let acc2 = we;
    for (let i = activeIndex + 1; i < slots.length; i += 1) {
      const s = slots[i];
      if (s === undefined) continue;
      const sp = (s.end - s.start) * aScale;
      pushOverview(acc2, acc2 + sp, s.wedge, 1 - t, `a-${s.wedge.key}`);
      acc2 += sp;
    }

    // Active wedge: overview representation crossfades out, detail crossfades in.
    pushOverview(ws, we, k.wedge, 1 - t, 'k-ov');
    pushDetail(ws, we, k.wedge, t, 'k-dt');
    return segs;
  }, [slots, activeIndex, t, hoverIndex]);

  const activeWedge = activeIndex !== null ? wedges[activeIndex] : undefined;
  const showActive = activeWedge !== undefined && t >= 0.5;
  const center = showActive ? activeWedge.center : overviewCenter;
  const centerOpacity = reducedMotion ? 1 : 1 - Math.sin(clamp01(t) * Math.PI) * 0.6;

  // Cap the chart so it fills width but never dwarfs the panel. The chart area
  // reclaims the side padding (`-mx-2`), so it gets `box.w - 16`. Reserve the
  // header (~44) and the legend (~3 rows + gaps, ~140).
  const availW = box.w > 0 ? box.w - 16 : 240;
  const availH = box.h > 0 ? box.h - 44 - 140 : 300;
  const chartMax = Math.round(Math.max(176, Math.min(availW, availH, 520)));

  const detailSegments = activeWedge?.detail.filter((d) => d.value > 0) ?? [];

  return (
    <div ref={boxRef} className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-4">
      <div className="flex items-center justify-between gap-2 pb-2">
        <Eyebrow as="span" tone="tertiary">{title}</Eyebrow>
        {headerRight}
      </div>

      <div className="-mx-2 flex min-h-0 flex-1 items-center justify-center py-2">
        <div className="relative w-full" style={{ maxWidth: chartMax }}>
          <div className="relative aspect-square w-full">
            <svg width="100%" height="100%" viewBox={`0 0 ${String(VIEW)} ${String(VIEW)}`}>
              <path d={ringPath()} fill="var(--surface-low)" fillRule="evenodd" aria-hidden />
              {segments.map((s) => (
                <path
                  key={s.key}
                  d={s.d}
                  fill={s.fill}
                  fillRule={s.ring ? 'evenodd' : 'nonzero'}
                  opacity={s.opacity}
                  aria-hidden
                />
              ))}
              {activeIndex === null &&
                slots.map((s) => {
                  const arc = buildArc(s.start, s.end);
                  const onActivate = (): void => expand(s.index);
                  const onKeyDown = (e: KeyboardEvent<SVGPathElement>): void => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onActivate();
                    }
                  };
                  const hit = (
                    <path
                      key={`hit-${s.wedge.key}`}
                      d={arc.d}
                      fill="transparent"
                      fillRule={arc.ring ? 'evenodd' : 'nonzero'}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        ariaLabelFor?.(s.wedge) ??
                        `${s.wedge.label}: ${String(s.wedge.meta.value)}/${String(s.wedge.meta.total)}`
                      }
                      onClick={onActivate}
                      onKeyDown={onKeyDown}
                      onPointerEnter={() => { setHoverIndex(s.index); }}
                      onPointerLeave={() => { setHoverIndex(null); }}
                      className="cursor-pointer outline-none focus-visible:stroke-[var(--border-focus)] [stroke-width:2]"
                      style={{ pointerEvents: 'fill' }}
                    />
                  );
                  return renderWedgeHit ? renderWedgeHit(s.wedge, hit) : hit;
                })}
            </svg>

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span style={{ opacity: centerOpacity }} className="flex flex-col items-center">
                <span className="text-h3 font-semibold leading-none tabular-nums text-foreground">
                  {center.value}
                </span>
                <span className="mt-1 text-body3 text-foreground-tertiary">{center.label}</span>
              </span>
            </div>

            {activeIndex !== null && (
              <button
                type="button"
                onClick={collapse}
                title={backLabel}
                aria-label={backLabel}
                className="absolute inset-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              />
            )}
          </div>
        </div>
      </div>

      <ul className="flex w-full flex-col gap-1.5">
        {showActive
          ? detailSegments.length === 0
            ? (
              <li className="px-2 py-3 text-center text-body3 text-foreground-tertiary">
                {activeWedge.empty}
              </li>
            )
            : detailSegments.map((d) => (
              <li key={d.label} className="flex items-center gap-2.5 px-2 py-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">{d.label}</span>
                <span className="shrink-0 text-body3 font-semibold tabular-nums text-foreground">{d.value}</span>
              </li>
            ))
          : slots.map((s) => (
            <li key={s.wedge.key}>
              <button
                type="button"
                onClick={() => { expand(s.index); }}
                onPointerEnter={() => { setHoverIndex(s.index); }}
                onPointerLeave={() => { setHoverIndex(null); }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-background-hover"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.wedge.color }} />
                <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">{s.wedge.label}</span>
                <span className="shrink-0 text-body3 tabular-nums text-foreground-tertiary">
                  {s.wedge.meta.value}/{s.wedge.meta.total}
                </span>
                <span className="w-9 shrink-0 text-right text-body3 font-semibold tabular-nums text-foreground">
                  {s.wedge.meta.pct}%
                </span>
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}
