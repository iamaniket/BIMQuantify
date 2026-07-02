import type { CSSProperties, JSX } from 'react';

/**
 * Hero centerpiece art: an architectural blueprint elevation — ground line, a
 * two-volume building (pitched-roof house + taller tower, echoing the brand
 * mark's glyph in packages/brand/src/BrandMarkArt.tsx), floor lines, window
 * strokes, and dimension ticks — that draws itself on load. Hand-authored
 * inline SVG, server-rendered, decorative (`aria-hidden`), ~5 KB.
 *
 * Every path carries `pathLength={1}` so the CSS draw-on animation
 * (`.hero-draw` in globals.css) works in path-agnostic units; groups stagger
 * via the `--draw-delay` custom property. Three snag pins pop in after the
 * draw (`.hero-pin`), one with a looping radar ping (`.hero-pin-ping`) — the
 * narrative hand-off to the live pinned 3D model one scroll below. Reduced
 * motion sees the finished drawing: the animation classes only exist behind a
 * no-preference media query, and the ping ring hides via its opacity=0 base.
 */

const drawDelay = (value: string): CSSProperties =>
  ({ '--draw-delay': value }) as CSSProperties;

const pinDelay = (value: string): CSSProperties =>
  ({ '--pin-delay': value }) as CSSProperties;

function DrawPath({ d }: { d: string }): JSX.Element {
  return <path className="hero-draw" pathLength={1} d={d} />;
}

/** Snag pins, placed on drawn geometry (ridge, tower window, door corner). */
const PINS: { cx: number; cy: number; delay: string; ping?: boolean }[] = [
  { cx: 164, cy: 152, delay: '2.2s' },
  { cx: 318, cy: 204, delay: '2.35s', ping: true },
  { cx: 212, cy: 292, delay: '2.5s' },
];

export function HeroBlueprint(): JSX.Element {
  return (
    <svg
      viewBox="0 0 520 380"
      aria-hidden
      className="h-auto w-full max-w-[520px]"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeLinejoin="round">
        {/* Ground line — drawn first, the base every volume lands on. */}
        <g className="text-white/70" strokeWidth={1.5}>
          <DrawPath d="M 24 330 H 496" />
        </g>

        {/* House volume: walls, eaves and a pitched roof with overhang. */}
        <g className="text-white/70" strokeWidth={1.5} style={drawDelay('0.18s')}>
          <DrawPath d="M 90 330 V 214" />
          <DrawPath d="M 238 330 V 214" />
          <DrawPath d="M 78 214 H 250" />
          <DrawPath d="M 78 214 L 164 152 L 250 214" />
        </g>

        {/* Tower volume: outline, parapet line, rooftop access box. */}
        <g className="text-white/70" strokeWidth={1.5} style={drawDelay('0.36s')}>
          <DrawPath d="M 254 330 V 96 H 390 V 330" />
          <DrawPath d="M 254 112 H 390" />
          <DrawPath d="M 300 96 V 80 H 332 V 96" />
        </g>

        {/* Floor lines. */}
        <g className="text-white/60" strokeWidth={1.25} style={drawDelay('0.6s')}>
          <DrawPath d="M 90 272 H 238" />
          <DrawPath d="M 254 184 H 390" />
          <DrawPath d="M 254 256 H 390" />
        </g>

        {/* Window strokes + entrance door. */}
        <g className="text-white/60" strokeWidth={1.25} style={drawDelay('0.78s')}>
          <DrawPath d="M 116 234 H 150 V 258 H 116 Z" />
          <DrawPath d="M 178 234 H 212 V 258 H 178 Z" />
          <DrawPath d="M 116 290 H 150 V 314 H 116 Z" />
          <DrawPath d="M 178 330 V 292 H 212 V 330" />
          <DrawPath d="M 282 132 H 318 V 160 H 282 Z" />
          <DrawPath d="M 282 204 H 318 V 232 H 282 Z" />
          <DrawPath d="M 282 276 H 318 V 304 H 282 Z" />
          <DrawPath d="M 344 132 H 362 V 160 H 344 Z" />
          <DrawPath d="M 344 204 H 362 V 232 H 344 Z" />
          <DrawPath d="M 344 276 H 362 V 304 H 344 Z" />
        </g>

        {/* Dimension lines with architectural slash ticks. */}
        <g className="text-white/50" strokeWidth={1} style={drawDelay('0.95s')}>
          <DrawPath d="M 90 352 H 390" />
          <DrawPath d="M 86 356 L 94 348" />
          <DrawPath d="M 250 356 L 258 348" />
          <DrawPath d="M 386 356 L 394 348" />
          <DrawPath d="M 428 96 V 330" />
          <DrawPath d="M 424 100 L 432 92" />
          <DrawPath d="M 424 334 L 432 326" />
        </g>
      </g>

      {/* Snag pins — brand-accent dots with a hairline ring, popping in once
          the drawing settles. The tower pin carries the looping ping. */}
      {PINS.map((pin) => (
        <g
          key={`${pin.cx}-${pin.cy}`}
          className="hero-pin text-[var(--brand-accent)]"
          style={pinDelay(pin.delay)}
        >
          <circle cx={pin.cx} cy={pin.cy} r={4} fill="currentColor" />
          <circle
            cx={pin.cx}
            cy={pin.cy}
            r={7.5}
            stroke="currentColor"
            strokeWidth={1}
            opacity={0.55}
          />
        </g>
      ))}
      {PINS.filter((pin) => pin.ping === true).map((pin) => (
        <circle
          key={`ping-${pin.cx}-${pin.cy}`}
          className="hero-pin-ping text-[var(--brand-accent)]"
          cx={pin.cx}
          cy={pin.cy}
          r={9}
          stroke="currentColor"
          strokeWidth={1.5}
          opacity={0}
          style={pinDelay('3.1s')}
        />
      ))}
    </svg>
  );
}
